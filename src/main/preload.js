const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pandaAPI', {
  getAllTasks: () => ipcRenderer.invoke('get-all-tasks'),
  addTask: (data) => ipcRenderer.invoke('add-task', data),
  pauseTask: (id) => ipcRenderer.invoke('pause-task', id),
  resumeTask: (id) => ipcRenderer.invoke('resume-task', id),
  cancelTask: (id) => ipcRenderer.invoke('cancel-task', id),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  openFolder: (filePath) => ipcRenderer.invoke('open-folder', filePath),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  getSaveDirectory: () => ipcRenderer.invoke('get-save-directory'),

  deleteTask: (id, deleteFileFromDisk = false) => ipcRenderer.invoke('delete-task', { id, deleteFileFromDisk }),
  addBatchTasks: (data) => ipcRenderer.invoke('add-batch-tasks', data),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openExtensionFolder: () => ipcRenderer.invoke('open-extension-folder'),

  // Window control
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  showStatusWindow: (taskId) => ipcRenderer.invoke('show-status-window', taskId),
  closeStatusWindow: () => ipcRenderer.invoke('close-status-window'),
  resizeStatusWindow: (expanded) => ipcRenderer.invoke('resize-status-window', { expanded }),

  closePromptWindow: () => ipcRenderer.invoke('close-prompt-window'),
  startDownloadFromPrompt: (data) => ipcRenderer.invoke('start-download-from-prompt', data),
  queueDownloadFromPrompt: (data) => ipcRenderer.invoke('queue-download-from-prompt', data),

  onPromptInfo: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('set-download-prompt-info', handler);
    return () => ipcRenderer.removeListener('set-download-prompt-info', handler);
  },

  onActiveStatusTask: (callback) => {
    const handler = (event, taskId) => callback(taskId);
    ipcRenderer.on('set-active-status-task', handler);
    return () => ipcRenderer.removeListener('set-active-status-task', handler);
  },

  // Event listeners
  onProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('task-progress', handler);
    return () => ipcRenderer.removeListener('task-progress', handler);
  },
  onSpeed: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('task-speed', handler);
    return () => ipcRenderer.removeListener('task-speed', handler);
  },
  onStatus: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('task-status', handler);
    return () => ipcRenderer.removeListener('task-status', handler);
  },
  onCompleted: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('task-completed', handler);
    return () => ipcRenderer.removeListener('task-completed', handler);
  },
  onError: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('task-error', handler);
    return () => ipcRenderer.removeListener('task-error', handler);
  },
  onDynamicSplit: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('task-dynamic-split', handler);
    return () => ipcRenderer.removeListener('task-dynamic-split', handler);
  },
  onClipboardDetected: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('clipboard-url-detected', handler);
    return () => ipcRenderer.removeListener('clipboard-url-detected', handler);
  },
  onBrowserIntercepted: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('browser-download-intercepted', handler);
    return () => ipcRenderer.removeListener('browser-download-intercepted', handler);
  },
  onTaskDeleted: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('task-deleted', handler);
    return () => ipcRenderer.removeListener('task-deleted', handler);
  },
  onHistoryCleared: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('history-cleared', handler);
    return () => ipcRenderer.removeListener('history-cleared', handler);
  },
  onOpenAddModal: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('open-add-modal', handler);
    return () => ipcRenderer.removeListener('open-add-modal', handler);
  },
  onOpenSettingsModal: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('open-settings-modal', handler);
    return () => ipcRenderer.removeListener('open-settings-modal', handler);
  }
});
