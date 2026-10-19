const { app, BrowserWindow, ipcMain, shell, clipboard, Tray, Menu, Notification, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { DownloadManager } = require('./downloader/manager');
const settingsManager = require('./settings');

let mainWindow = null;
let statusWindow = null;
let downloadManager = null;
let tray = null;
let lastClipboardText = '';
let loopbackServer = null;
let isQuitting = false;

const PORT = 45731;

process.on('uncaughtException', (err) => {
  console.error('[Panda Downloader] Global Exception Caught:', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Panda Downloader] Global Rejection Caught:', reason);
});

function showDownloadStatusWindow(taskId) {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.show();
    statusWindow.focus();
    if (taskId) {
      statusWindow.webContents.send('set-active-status-task', taskId);
    }
    return;
  }

  const iconPath = path.join(__dirname, '../../assets/icon.png');
  statusWindow = new BrowserWindow({
    width: 600,
    height: 410,
    minWidth: 540,
    minHeight: 380,
    resizable: false,
    maximizable: false,
    alwaysOnTop: true, // Floats over all apps like IDM!
    frame: false,
    backgroundColor: '#070a12',
    icon: iconPath,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const distHtml = path.join(__dirname, '../../dist/index.html');
  const isViteDev = process.env.VITE_DEV === 'true';

  if (isViteDev) {
    statusWindow.loadURL('http://localhost:5173#status').catch(() => {
      statusWindow.loadFile(distHtml, { hash: 'status' });
    });
  } else if (fs.existsSync(distHtml)) {
    statusWindow.loadFile(distHtml, { hash: 'status' });
  } else {
    statusWindow.loadURL('http://localhost:5173#status');
  }

  statusWindow.webContents.once('did-finish-load', () => {
    if (statusWindow && !statusWindow.isDestroyed() && taskId) {
      statusWindow.webContents.send('set-active-status-task', taskId);
    }
  });

  statusWindow.on('closed', () => {
    statusWindow = null;
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  const isBackground = process.argv.includes('--background') || process.argv.includes('--silent');

  mainWindow = new BrowserWindow({
    width: 1220,
    height: 780,
    minWidth: 880,
    minHeight: 580,
    backgroundColor: '#070a12',
    icon: iconPath,
    frame: false,
    show: !isBackground, // Stay silent in tray if started in background
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const distHtml = path.join(__dirname, '../../dist/index.html');
  const isViteDev = process.env.VITE_DEV === 'true';

  if (isViteDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow.loadFile(distHtml);
    });
  } else if (fs.existsSync(distHtml)) {
    // Instant zero-delay load from built distribution
    mainWindow.loadFile(distHtml);
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  // Minimize to tray on close
  mainWindow.on('close', (event) => {
    const settings = settingsManager.get();
    if (!isQuitting && settings.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      if (Notification.isSupported()) {
        new Notification({
          title: 'Panda Downloader',
          body: 'Panda Downloader is running in the background and monitoring downloads.'
        }).show();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Panda Downloader by PB Tech Zone');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Panda Downloader',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Add Download...',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('open-add-modal');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Pause All',
      click: () => {
        for (const task of downloadManager.tasks.values()) {
          task.pause();
        }
      }
    },
    {
      label: 'Resume All',
      click: () => {
        for (const task of downloadManager.tasks.values()) {
          task.resume();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('open-settings-modal');
        }
      }
    },
    {
      label: 'PB Tech Zone Website',
      click: () => {
        shell.openExternal('https://prakash77.com.np');
      }
    },
    {
      label: 'WhatsApp Support (+977 9814891277)',
      click: () => {
        shell.openExternal('https://wa.me/9779814891277');
      }
    },
    { type: 'separator' },
    {
      label: 'Exit Panda Downloader',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function startLoopbackServer() {
  loopbackServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'running', version: '1.0.0', settings: settingsManager.get() }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/intercept') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data && data.url) {
            const settings = settingsManager.get();

            // Directly start download and show ONLY the standalone small IDM status window
            // Main application window stays hidden in background/system tray
            const task = downloadManager.createTask(data.url, {
              filename: data.filename,
              format: data.format,
              quality: data.quality,
              headers: data.headers || {}
            });

            // Pop up only the compact, topmost IDM status window
            showDownloadStatusWindow(task.id);

            // Silently forward task to mainWindow so task lists stay updated
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('task-status', { id: task.id, status: task.status, task: task.toJSON() });
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, taskId: task.id }));
            return;
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Malformed payload' }));
          return;
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing URL' }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  loopbackServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Panda Downloader] Port ${PORT} already in use. Primary instance daemon is active.`);
    } else {
      console.error('[Panda Downloader] Loopback server error:', err);
    }
  });

  loopbackServer.listen(PORT, '127.0.0.1', () => {
    console.log(`[Panda Downloader] Background daemon listening on http://127.0.0.1:${PORT}`);
  });
}

function startClipboardMonitor() {
  const MEDIA_REGEX = /^https?:\/\/.+\.(mp4|webm|mkv|zip|iso|exe|msi|rar|tar\.gz|pdf|7z|apk|flac|wav|mp3)(\?.*)?$/i;
  const VIDEO_PORTAL_REGEX = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|dailymotion\.com|instagram\.com|x\.com|twitter\.com)\/.+$/i;

  setInterval(() => {
    try {
      const text = clipboard.readText().trim();
      if (text && text !== lastClipboardText && text.length < 2048) {
        lastClipboardText = text;
        if (MEDIA_REGEX.test(text) || VIDEO_PORTAL_REGEX.test(text)) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('clipboard-url-detected', { url: text });
          }
        }
      }
    } catch (e) {}
  }, 1200);
}

function setupIpcHandlers() {
  ipcMain.handle('get-all-tasks', () => {
    return downloadManager.getAllTasks();
  });

  ipcMain.handle('add-task', (event, { url, filename, format, quality, connectionsCount, saveDirectory }) => {
    const task = downloadManager.createTask(url, {
      filename,
      format,
      quality,
      connectionsCount,
      saveDirectory
    });
    showDownloadStatusWindow(task.id);
    return task.toJSON();
  });

  ipcMain.handle('show-status-window', (event, taskId) => {
    showDownloadStatusWindow(taskId);
    return { success: true };
  });

  ipcMain.handle('close-status-window', () => {
    if (statusWindow && !statusWindow.isDestroyed()) {
      statusWindow.close();
      statusWindow = null;
    }
    return { success: true };
  });

  ipcMain.handle('add-batch-tasks', (event, { urls, connectionsCount, saveDirectory }) => {
    return downloadManager.createBatchTasks(urls, {
      connectionsCount,
      saveDirectory
    });
  });

  ipcMain.handle('pause-task', (event, id) => {
    downloadManager.pauseTask(id);
    return { success: true };
  });

  ipcMain.handle('resume-task', (event, id) => {
    downloadManager.resumeTask(id);
    return { success: true };
  });

  ipcMain.handle('cancel-task', (event, id) => {
    downloadManager.cancelTask(id);
    return { success: true };
  });

  ipcMain.handle('delete-task', (event, { id, deleteFileFromDisk }) => {
    downloadManager.deleteTask(id, deleteFileFromDisk);
    return { success: true };
  });

  ipcMain.handle('open-file', (event, filePath) => {
    if (!filePath) return;
    if (fs.existsSync(filePath)) {
      shell.openPath(filePath);
    } else {
      const dir = path.dirname(filePath);
      if (fs.existsSync(dir)) {
        shell.openPath(dir);
      }
    }
  });

  ipcMain.handle('open-folder', (event, filePath) => {
    if (!filePath) return;
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    } else {
      const dir = path.dirname(filePath);
      if (fs.existsSync(dir)) {
        shell.openPath(dir);
      }
    }
  });

  ipcMain.handle('clear-history', (event, { deleteFilesFromDisk }) => {
    downloadManager.clearHistory(deleteFilesFromDisk);
    return { success: true };
  });

  // Settings
  ipcMain.handle('get-settings', () => {
    return settingsManager.get();
  });

  ipcMain.handle('save-settings', (event, newSettings) => {
    return settingsManager.save(newSettings);
  });

  ipcMain.handle('select-directory', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('open-external', (event, url) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url);
    }
  });

  ipcMain.handle('open-extension-folder', () => {
    let extDir = path.resolve(__dirname, '../../extension');
    if (!fs.existsSync(extDir)) {
      const prodPath = path.join(path.dirname(process.execPath), 'extension');
      if (fs.existsSync(prodPath)) extDir = prodPath;
    }
    shell.openPath(extDir);
    clipboard.writeText(extDir);
    shell.openExternal('chrome://extensions');
    return { path: extDir, success: true };
  });

  // Window Controls
  ipcMain.handle('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.handle('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  });

  ipcMain.handle('window-close', () => {
    if (mainWindow) mainWindow.close();
  });
}

function setupManagerEventForwarding() {
  const forwardEvents = [
    'task-progress',
    'task-speed',
    'task-status',
    'task-error',
    'task-dynamic-split',
    'task-deleted',
    'history-cleared'
  ];

  forwardEvents.forEach(evt => {
    downloadManager.on(evt, (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(evt, data);
      }
      if (statusWindow && !statusWindow.isDestroyed()) {
        statusWindow.webContents.send(evt, data);
      }
    });
  });

  // Native notification on completed
  downloadManager.on('task-completed', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task-completed', data);
    }
    if (statusWindow && !statusWindow.isDestroyed()) {
      statusWindow.webContents.send('task-completed', data);
    }

    const settings = settingsManager.get();
    if (settings.showCompletionDialog && Notification.isSupported()) {
      const notif = new Notification({
        title: 'Download Completed! 🐼',
        body: `${data.filename} (${(data.totalBytes / (1024 * 1024)).toFixed(1)} MB)`
      });
      notif.on('click', () => {
        if (data.filePath) shell.showItemInFolder(data.filePath);
      });
      notif.show();
    }
  });

  // Update tray tooltip on speed
  downloadManager.on('task-speed', (data) => {
    if (tray) {
      const spd = data.speed;
      const spdStr = spd > 1024 * 1024 
        ? `${(spd / (1024 * 1024)).toFixed(1)} MB/s` 
        : `${(spd / 1024).toFixed(0)} KB/s`;
      tray.setToolTip(`Panda Downloader - ${spdStr}`);
    }
  });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running; exit gracefully without conflict
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Focus the existing main window if another instance was launched
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    downloadManager = new DownloadManager();
    setupManagerEventForwarding();
    setupIpcHandlers();
    startLoopbackServer();
    startClipboardMonitor();
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    const settings = settingsManager.get();
    if (!settings.minimizeToTray || isQuitting) {
      if (loopbackServer) {
        try { loopbackServer.close(); } catch (e) {}
      }
      app.quit();
    }
  });
}
