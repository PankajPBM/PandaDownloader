const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { DownloadTask } = require('./engine');
const { VideoDownloadTask, isVideoPortalUrl } = require('./videoEngine');
const settingsManager = require('../settings');

class DownloadManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.historyFile = options.historyFile || path.join(
      process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads', 'PandaDownloads') : process.cwd(),
      'download_history.json'
    );

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
        this.history = JSON.parse(raw);
      }
    } catch (e) {
      this.history = [];
    }
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
    if (!targetDir) {
      targetDir = settingsManager.getTargetDirForFile(options.filename || url);
    }

    let task;
    if (isVideoPortalUrl(url)) {
      task = new VideoDownloadTask({
        url,
        filename: options.filename,
        saveDirectory: targetDir,
        connectionsCount: threads
      });
    } else {
      task = new DownloadTask({
        url,
        filename: options.filename,
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
      this.history.unshift({
        ...task.toJSON(),
        completedAt: new Date().toISOString()
      });
      this._saveHistory();
      this.emit('task-completed', data);
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
