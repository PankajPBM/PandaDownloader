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

  getCategory(filename = '', url = '') {
    const combined = `${filename} ${url}`.toLowerCase();
    
    // Check video portals
    if (/youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|dailymotion\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|twitch\.tv|bilibili\.com/i.test(combined)) {
      if (/\.(mp3|wav|m4a|flac|aac|ogg|opus)/i.test(filename)) return 'audio';
      return 'video';
    }

    let cleanExt = (path.extname(filename || '') || path.extname(url.split('?')[0] || '')).replace(/^\./, '').toLowerCase();

    if (['mp4', 'webm', 'mkv', 'flv', 'avi', 'mov', 'wmv', 'm3u8', 'mpd', 'ts', 'm4v', '3gp'].includes(cleanExt)) return 'video';
    if (['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'opus', 'wma', 'mid', 'midi'].includes(cleanExt)) return 'audio';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'bz2', 'xz', '7zip', 'tgz'].includes(cleanExt)) return 'compressed';
    if (['exe', 'msi', 'apk', 'dmg', 'bin', 'deb', 'rpm', 'pkg', 'jar', 'app'].includes(cleanExt)) return 'programs';
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub', 'mobi', 'rtf', 'csv'].includes(cleanExt)) return 'documents';

    return 'general';
  }

  getCategoryForExtension(ext) {
    return this.getCategory(`file.${ext}`);
  }

  ensureCategoryFolders() {
    try {
      const baseDir = this.settings.defaultSaveDir;
      if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
      }
      for (const folder of Object.values(this.settings.categoryFolders)) {
        const full = path.join(baseDir, folder);
        if (!fs.existsSync(full)) {
          fs.mkdirSync(full, { recursive: true });
        }
      }
    } catch (e) {}
  }

  getTargetDirForFile(filename, url = '') {
    this.ensureCategoryFolders();
    const baseDir = this.settings.defaultSaveDir;
    if (!this.settings.autoCategorize) return baseDir;

    const category = this.getCategory(filename, url);
    const folderName = this.settings.categoryFolders[category] || 'General';

    const fullPath = path.join(baseDir, folderName);
    if (!fs.existsSync(fullPath)) {
      try { fs.mkdirSync(fullPath, { recursive: true }); } catch (e) {}
    }
    return fullPath;
  }
}

const instance = new SettingsManager();
instance.ensureCategoryFolders();
module.exports = instance;
