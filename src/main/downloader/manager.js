const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { app } = require('electron');
const { DownloadTask } = require('./engine');
const { VideoDownloadTask, isVideoPortalUrl } = require('./videoEngine');
const settingsManager = require('../settings');

function fixMojibake(str) {
  if (!str || typeof str !== 'string') return str || '';
  if (/[\u00C2\u00C3\u00C4\u00C5\u00E0-\u00EF]/.test(str)) {
    try {
      const fixed = decodeURIComponent(escape(str));
      if (fixed && fixed.length > 0) return fixed;
    } catch (e) {}
  }
  return str;
}

class DownloadManager extends EventEmitter {
  constructor(options = {}) {
    super();
    const userDataDir = options.userDataDir || (app ? app.getPath('userData') : path.join(process.env.APPDATA || process.cwd(), 'panda-downloader'));
    if (!fs.existsSync(userDataDir)) {
      try { fs.mkdirSync(userDataDir, { recursive: true }); } catch (e) {}
    }
    this.historyFile = options.historyFile || path.join(userDataDir, 'download_history.json');

    this.tasks = new Map(); // id -> DownloadTask
    this.history = [];      // Completed or cancelled tasks
    this._loadHistory();

    const saveDir = settingsManager.get().defaultSaveDir;
    if (!fs.existsSync(saveDir)) {
      try { fs.mkdirSync(saveDir, { recursive: true }); } catch (e) {}
    }
  }

  _loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const raw = fs.readFileSync(this.historyFile, 'utf-8');
        const parsed = JSON.parse(raw);
        this.history = Array.isArray(parsed) ? parsed.map(item => ({
          ...item,
          filename: fixMojibake(item.filename),
          name: fixMojibake(item.name)
        })) : [];
      } else {
        // Auto-migrate legacy file if present in user's downloads folder
        const legacyFile = path.join(
          process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads', 'PandaDownloads') : process.cwd(),
          'download_history.json'
        );
        if (fs.existsSync(legacyFile)) {
          const raw = fs.readFileSync(legacyFile, 'utf-8');
          const parsed = JSON.parse(raw);
          this.history = Array.isArray(parsed) ? parsed.map(item => ({
            ...item,
            filename: fixMojibake(item.filename),
            name: fixMojibake(item.name)
          })) : [];
          this._saveHistory();
        }
      }
    } catch (e) {
      this.history = [];
    }

    // Always remove legacy history file from user's downloads folder to keep it clean
    try {
      const legacyFile = path.join(
        process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads', 'PandaDownloads') : process.cwd(),
        'download_history.json'
      );
      if (fs.existsSync(legacyFile)) {
        fs.unlinkSync(legacyFile);
      }
    } catch (e) {}
  }

  _saveHistory() {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2), 'utf-8');
    } catch (e) {}
  }

  createTask(url, options = {}) {
    const settings = settingsManager.get();
    const threads = options.connectionsCount || settings.defaultThreads || 16;
    
    // Determine category folder
    let targetDir = options.saveDirectory;
    if (!targetDir || targetDir === settings.defaultSaveDir) {
      targetDir = settingsManager.getTargetDirForFile(options.filename || '', url);
    }

    const isM3u8OrMpd = /\.(m3u8|mpd)(\?.*)?$/i.test(url);
    const isPortal = isVideoPortalUrl(url);
    const isExplicitDirect = options.quality === 'direct' || options.quality === 'file' || Boolean(options.directStreamUrl);
    const isDirectBinary = /\.(zip|rar|7z|tar|gz|bz2|iso|xz|exe|msi|apk|dmg|pkg|deb|rpm|bin|img|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|rtf|torrent)(\?.*)?$/i.test(url);
    const isDirectMediaFile = /\.(mp4|webm|mkv|mov|flv|avi|mp3|m4a|wav|aac|flac|ogg|opus)(\?.*)?$/i.test(url);

    // IDM-Style Instant Connection Routing:
    // When a direct stream URL or media file is available, bypass yt-dlp scraping entirely and route directly
    // to DownloadTask's 16-thread concurrent HTTP Range socket engine for instant <100ms startup!
    // VideoDownloadTask (yt-dlp) is reserved only for raw portal webpages (e.g. youtube.com/watch) or adaptive HLS (.m3u8/.mpd).
    const useVideoEngine = !isExplicitDirect && !isDirectBinary && (isM3u8OrMpd || (isPortal && !isDirectMediaFile));

    let task;
    if (useVideoEngine) {
      task = new VideoDownloadTask({
        url: options.directStreamUrl || url,
        filename: options.filename,
        format: options.format || 'mp4',
        quality: options.quality || 'best',
        fileSize: options.fileSize || 0,
        saveDirectory: targetDir,
        connectionsCount: threads,
        headers: options.headers || {}
      });
    } else {
      task = new DownloadTask({
        url: options.directStreamUrl || url,
        filename: options.filename,
        fileSize: options.fileSize || 0,
        saveDirectory: targetDir,
        connectionsCount: threads,
        headers: options.headers || {}
      });
    }

    this.tasks.set(task.id, task);

    // Event hooks
    task.on('progress', (progress) => {
      this.emit('task-progress', progress);
    });

    task.on('speed', (data) => {
      this.emit('task-speed', data);
    });

    task.on('status-changed', (data) => {
      this.emit('task-status', { id: task.id, status: data.status, task: task.toJSON() });
      this._checkQueue();
    });

    task.on('completed', (data) => {
      const json = task.toJSON();
      const completedTask = {
        ...json,
        status: 'completed',
        percent: 100,
        speed: 0,
        downloadedBytes: json.totalBytes > 0 ? json.totalBytes : json.downloadedBytes,
        completedAt: new Date().toISOString()
      };
      this.history.unshift(completedTask);
      this.tasks.delete(task.id);
      this._saveHistory();
      this.emit('task-completed', completedTask);
      this._checkQueue();
    });

    task.on('error', (err) => {
      this.emit('task-error', { id: task.id, error: err.message });
      this._checkQueue();
    });

    task.on('dynamic-split', (data) => {
      this.emit('task-dynamic-split', { id: task.id, ...data });
    });

    this._checkQueue();
    return task;
  }

  createBatchTasks(urls, options = {}) {
    const created = [];
    const urlList = Array.isArray(urls) ? urls : this.expandUrlPattern(urls);

    for (const u of urlList) {
      if (u && u.trim().startsWith('http')) {
        const task = this.createTask(u.trim(), options);
        created.push(task.toJSON());
      }
    }
    return created;
  }

  // Expands patterns like https://example.com/file[1-10].zip
  expandUrlPattern(patternText) {
    const lines = patternText.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
    const result = [];

    for (const line of lines) {
      const match = line.match(/\[(\d+)-(\d+)\]/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = parseInt(match[2], 10);
        const padLen = match[1].length;

        for (let i = start; i <= end; i++) {
          const numStr = String(i).padStart(padLen, '0');
          result.push(line.replace(match[0], numStr));
        }
      } else {
        result.push(line);
      }
    }
    return result;
  }

  _checkQueue() {
    const settings = settingsManager.get();
    const max = settings.maxConcurrent || 4;

    let activeCount = 0;
    const idleTasks = [];

    for (const task of this.tasks.values()) {
      if (task.status === 'downloading' || task.status === 'probing') {
        activeCount++;
      } else if (task.status === 'idle') {
        idleTasks.push(task);
      }
    }

    while (activeCount < max && idleTasks.length > 0) {
      const nextTask = idleTasks.shift();
      activeCount++;
      nextTask.start();
    }
  }

  pauseTask(id) {
    const task = this.tasks.get(id);
    if (task) {
      task.pause();
    }
  }

  resumeTask(id) {
    const task = this.tasks.get(id);
    if (task) {
      task.resume();
    }
  }

  cancelTask(id) {
    const task = this.tasks.get(id);
    if (task) {
      task.cancel();
      this.tasks.delete(id);
    }
  }

  deleteTask(id, deleteFileFromDisk = false) {
    const task = this.tasks.get(id);
    let filePath = '';

    if (task) {
      filePath = task.filePath;
      task.cancel();
      this.tasks.delete(id);
    } else {
      // Check in history
      const idx = this.history.findIndex(h => h.id === id);
      if (idx !== -1) {
        filePath = this.history[idx].filePath;
        this.history.splice(idx, 1);
        this._saveHistory();
      }
    }

    if (deleteFileFromDisk && filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {}
    }

    this.emit('task-deleted', { id, deleteFileFromDisk });
  }

  getAllTasks() {
    const active = Array.from(this.tasks.values()).map(t => t.toJSON());
    return {
      active,
      history: this.history
    };
  }

  clearHistory(deleteFilesFromDisk = false) {
    if (deleteFilesFromDisk) {
      this.history.forEach(item => {
        if (item.filePath && fs.existsSync(item.filePath)) {
          try { fs.unlinkSync(item.filePath); } catch (e) {}
        }
      });
    }
    this.history = [];
    this._saveHistory();
    this.emit('history-cleared');
  }
}

module.exports = { DownloadManager };
