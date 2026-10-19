const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SETTINGS_FILE = path.join(
  app ? app.getPath('userData') : process.cwd(),
  'panda_settings.json'
);

const DEFAULT_SETTINGS = {
  defaultSaveDir: process.env.USERPROFILE 
    ? path.join(process.env.USERPROFILE, 'Downloads', 'PandaDownloads') 
    : path.join(process.cwd(), 'downloads'),
  autoCategorize: true,
  categoryFolders: {
    video: 'Video',
    audio: 'Audio',
    compressed: 'Compressed',
    programs: 'Programs',
    documents: 'Documents',
    general: 'General'
  },
  defaultThreads: 16,
  maxConcurrent: 4,
  speedLimitKBps: 0, // 0 = unlimited
  autoAcceptDownloads: false, // if true, starts immediately without confirmation dialog
  showCompletionDialog: true,
  minimizeToTray: true,
  capturedExtensions: [
    'mp4', 'webm', 'mkv', 'flv', 'avi', 'mov', 'wmv',
    'mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg',
    'zip', 'rar', '7z', 'tar', 'gz', 'iso', 'bz2',
    'exe', 'msi', 'apk', 'dmg',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
  ]
};

class SettingsManager {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
    } catch (e) {
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  save(newSettings) {
    try {
      this.settings = { ...this.settings, ...newSettings };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), 'utf-8');
      return true;
    } catch (e) {
      return false;
    }
  }

  get() {
    return this.settings;
  }

  getCategoryForExtension(ext) {
    if (!ext) return 'general';
    const cleanExt = ext.replace(/^\./, '').toLowerCase();

    if (['mp4', 'webm', 'mkv', 'flv', 'avi', 'mov', 'wmv', 'm3u8', 'mpd'].includes(cleanExt)) return 'video';
    if (['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg'].includes(cleanExt)) return 'audio';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'bz2', '7zip'].includes(cleanExt)) return 'compressed';
    if (['exe', 'msi', 'apk', 'dmg', 'bin'].includes(cleanExt)) return 'programs';
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'].includes(cleanExt)) return 'documents';

    return 'general';
  }

  getTargetDirForFile(filename) {
    const baseDir = this.settings.defaultSaveDir;
    if (!this.settings.autoCategorize) return baseDir;

    const ext = path.extname(filename);
    const category = this.getCategoryForExtension(ext);
    const folderName = this.settings.categoryFolders[category] || 'General';

    const fullPath = path.join(baseDir, folderName);
    if (!fs.existsSync(fullPath)) {
      try { fs.mkdirSync(fullPath, { recursive: true }); } catch (e) {}
    }
    return fullPath;
  }
}

module.exports = new SettingsManager();
