const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');
const { URL } = require('url');
const settingsManager = require('../settings');

class DownloadTask extends EventEmitter {
  constructor(options) {
    super();
    this.id = options.id || `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.url = options.url;
    this.headers = options.headers || {};
    this.customFilename = options.filename;
    this.saveDirectory = options.saveDirectory || (process.env.USERPROFILE 
      ? path.join(process.env.USERPROFILE, 'Downloads') 
      : path.join(process.cwd(), 'downloads'));
    this.connectionsCount = options.connectionsCount || 8;
    this.maxRetries = options.maxRetries || 5;

    this.filename = this.customFilename || 'download.bin';
    this.filePath = '';
    this.metadataPath = '';
    this.totalBytes = 0;
    this.downloadedBytes = 0;
    this.supportsRange = false;
    this.status = 'idle'; // 'idle', 'probing', 'downloading', 'paused', 'completed', 'error'
    this.error = null;

    this.segments = [];
    this.activeRequests = [];
    this.fileDescriptor = null;
    this.speed = 0;
    this.lastBytes = 0;
    this.speedTimer = null;
    this.dynamicSplitThreshold = 512 * 1024; // 512KB minimum chunk for dynamic IDM work-stealing
  }

  async start() {
    try {
      this.status = 'probing';
      this.emit('status-changed', { status: this.status });
      await this._probeServer();

      if (!fs.existsSync(this.saveDirectory)) {
        fs.mkdirSync(this.saveDirectory, { recursive: true });
      }

      this.filePath = path.join(this.saveDirectory, this.filename);
      this.metadataPath = `${this.filePath}.panda`;

      // Check if resuming from previous session
      if (this.supportsRange && fs.existsSync(this.metadataPath) && fs.existsSync(this.filePath)) {
        this._loadMetadata();
      } else {
        this._initializeSegments();
        this._createTargetFile();
      }

      this.status = 'downloading';
      this.emit('status-changed', { status: this.status, task: this.toJSON() });
      this._startSpeedMonitor();

      if (!this.supportsRange || this.totalBytes === 0) {
        this._startSingleStreamDownload();
      } else {
        this._startMultiSegmentDownload();
      }
    } catch (err) {
      this.status = 'error';
      this.error = err.message;
      this.emit('error', err);
      this._cleanup();
    }
  }

  _probeServer() {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(this.url);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PandaDownloader/1.0',
        'Accept': '*/*',
        ...this.headers
      };

      // Use a Range GET 0-0 request to reliably detect Range support even if HEAD is blocked
      const options = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'GET',
        headers: {
          ...headers,
          'Range': 'bytes=0-0'
        }
      };

      const req = client.request(options, (res) => {
        // Follow redirects if any
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, this.url).toString();
          this.url = redirectUrl;
          req.destroy();
          return this._probeServer().then(resolve).catch(reject);
        }

        // Determine filename
        if (!this.customFilename) {
          const disposition = res.headers['content-disposition'];
          if (disposition) {
            const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
            if (filenameMatch && filenameMatch[1]) {
              this.filename = decodeURIComponent(filenameMatch[1].trim());
            }
          }
          if (!this.filename || this.filename === 'download.bin') {
            const urlPath = parsedUrl.pathname.split('/').filter(Boolean).pop();
            this.filename = urlPath ? decodeURIComponent(urlPath) : `file_${Date.now()}`;
          }
        }

        // Auto-detect extension from Content-Type if missing
        if (!path.extname(this.filename)) {
          const contentType = (res.headers['content-type'] || '').toLowerCase();
          const extMap = {
            'video/mp4': '.mp4',
            'video/webm': '.webm',
            'video/x-matroska': '.mkv',
            'video/quicktime': '.mov',
            'audio/mpeg': '.mp3',
            'audio/mp3': '.mp3',
            'audio/mp4': '.m4a',
            'audio/wav': '.wav',
            'audio/flac': '.flac',
            'application/zip': '.zip',
            'application/x-zip-compressed': '.zip',
            'application/x-rar-compressed': '.rar',
            'application/x-7z-compressed': '.7z',
            'application/pdf': '.pdf',
            'application/x-msdownload': '.exe',
            'application/vnd.android.package-archive': '.apk',
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/webp': '.webp'
          };
          for (const [mime, ext] of Object.entries(extMap)) {
            if (contentType.includes(mime)) {
              this.filename += ext;
              break;
            }
          }
        }

        // Sanitize filename for Windows
        this.filename = this.filename.replace(/[\\/:*?"<>|]/g, '_').trim();

        // If target directory is the base download folder, auto-categorize now that filename is confirmed
        if (settingsManager.get().autoCategorize && this.saveDirectory === settingsManager.get().defaultSaveDir) {
          this.saveDirectory = settingsManager.getTargetDirForFile(this.filename, this.url);
        }

        // Check Range support
        if (res.statusCode === 206) {
          this.supportsRange = true;
          const contentRange = res.headers['content-range'];
          if (contentRange) {
            const match = contentRange.match(/\/(\d+)/);
            if (match && match[1]) {
              this.totalBytes = parseInt(match[1], 10);
            }
          }
        } else if (res.statusCode === 200) {
          this.supportsRange = res.headers['accept-ranges'] === 'bytes';
          if (res.headers['content-length']) {
            this.totalBytes = parseInt(res.headers['content-length'], 10);
          }
        } else {
          req.destroy();
          return reject(new Error(`Server returned HTTP ${res.statusCode}: ${res.statusMessage}`));
        }

        req.destroy();
        resolve();
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy(new Error('Connection timed out probing server'));
      });
      req.end();
    });
  }

  _createTargetFile() {
    this.fileDescriptor = fs.openSync(this.filePath, 'w');
    if (this.totalBytes > 0) {
      try {
        // Pre-allocate file size on disk for zero-fragmentation writing
        fs.ftruncateSync(this.fileDescriptor, this.totalBytes);
      } catch (e) {
        // Fallback gracefully if filesystem doesn't support immediate truncate
      }
    }
  }

  _initializeSegments() {
    this.segments = [];
    if (!this.supportsRange || this.totalBytes <= 0) {
      this.segments.push({
        id: 0,
        start: 0,
        current: 0,
        end: this.totalBytes > 0 ? this.totalBytes - 1 : 0,
        total: this.totalBytes,
        downloaded: 0,
        status: 'pending'
      });
      return;
    }

    // Auto-scale optimal connections based on file size (Replicating IDM logic)
    let optimal = this.connectionsCount || 8;
    if (this.totalBytes < 512 * 1024) {
      optimal = 1; // < 512 KB: single connection avoids TLS overhead
    } else if (this.totalBytes < 2 * 1024 * 1024) {
      optimal = Math.min(2, optimal); // < 2 MB
    } else if (this.totalBytes < 10 * 1024 * 1024) {
      optimal = Math.min(4, optimal); // < 10 MB
    } else if (this.totalBytes < 50 * 1024 * 1024) {
      optimal = Math.min(8, optimal); // < 50 MB
    }

    const count = Math.max(1, optimal);
    const chunkSize = Math.floor(this.totalBytes / count);

    for (let i = 0; i < count; i++) {
      const start = i * chunkSize;
      const end = (i === count - 1) ? this.totalBytes - 1 : (start + chunkSize - 1);
      this.segments.push({
        id: i,
        start,
        current: start,
        end,
        total: (end - start + 1),
        downloaded: 0,
        status: 'pending'
      });
    }
  }

  _saveMetadata() {
    if (!this.supportsRange || this.status === 'completed') return;
    try {
      const data = JSON.stringify({
        id: this.id,
        url: this.url,
        filename: this.filename,
        totalBytes: this.totalBytes,
        segments: this.segments
      });
      fs.writeFileSync(this.metadataPath, data, 'utf-8');
    } catch (e) {
      // Non-critical write error
    }
  }

  _loadMetadata() {
    try {
      const raw = fs.readFileSync(this.metadataPath, 'utf-8');
      const meta = JSON.parse(raw);
      this.segments = meta.segments;
      this.downloadedBytes = this.segments.reduce((acc, s) => acc + s.downloaded, 0);
      this.fileDescriptor = fs.openSync(this.filePath, 'r+');
    } catch (e) {
      this._initializeSegments();
      this._createTargetFile();
    }
  }

  _startMultiSegmentDownload() {
    if (!this.fileDescriptor) {
      this.fileDescriptor = fs.openSync(this.filePath, 'r+');
    }

    this.segments.forEach(segment => {
      if (segment.current <= segment.end) {
        this._downloadSegment(segment);
      } else {
        segment.status = 'completed';
      }
    });
  }

  _downloadSegment(segment) {
    if (this.status !== 'downloading') return;

    segment.status = 'downloading';
    const parsedUrl = new URL(this.url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const rangeHeader = `bytes=${segment.current}-${segment.end}`;
    const options = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PandaDownloader/1.0',
        'Accept': '*/*',
        'Range': rangeHeader,
        ...this.headers
      }
    };

    const req = client.request(options, (res) => {
      if (res.statusCode !== 206 && res.statusCode !== 200) {
        segment.status = 'error';
        req.destroy();
        return this._retrySegment(segment);
      }

      res.on('data', (chunk) => {
        if (this.status !== 'downloading') {
          req.destroy();
          return;
        }

        const writeOffset = segment.current;
        const remaining = (segment.end - writeOffset + 1);
        if (remaining <= 0) {
          req.destroy();
          segment.status = 'completed';
          this._saveMetadata();
          this._checkDynamicSplitOrFinish();
          return;
        }

        const toWrite = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;
        segment.current += toWrite.length;
        segment.downloaded += toWrite.length;
        this.downloadedBytes += toWrite.length;

        // Write directly to file at target offset
        try {
          fs.writeSync(this.fileDescriptor, toWrite, 0, toWrite.length, writeOffset);
        } catch (err) {
          req.destroy();
          this.emit('error', err);
          return;
        }

        this.emit('progress', this.getProgress());

        if (segment.current > segment.end) {
          req.destroy();
          segment.status = 'completed';
          this._saveMetadata();
          this._checkDynamicSplitOrFinish();
        }
      });

      res.on('end', () => {
        segment.status = 'completed';
        this._saveMetadata();
        this._checkDynamicSplitOrFinish();
      });

      res.on('error', (err) => {
        segment.status = 'error';
        this._retrySegment(segment);
      });
    });

    req.on('error', (err) => {
      segment.status = 'error';
      this._retrySegment(segment);
    });

    this.activeRequests.push(req);
    req.end();
  }

  _retrySegment(segment) {
    if (this.status !== 'downloading') return;
    segment.retries = (segment.retries || 0) + 1;
    if (segment.retries <= this.maxRetries) {
      setTimeout(() => {
        if (this.status === 'downloading') {
          this._downloadSegment(segment);
        }
      }, 1500 * segment.retries);
    } else {
      this.status = 'error';
      this.error = `Segment ${segment.id} failed after ${this.maxRetries} retries`;
      this.emit('error', new Error(this.error));
      this._cleanup();
    }
  }

  // IDM-Style Dynamic Work Stealing: split largest unfinished segment
  _checkDynamicSplitOrFinish() {
    const allCompleted = this.segments.every(s => s.status === 'completed' || s.current > s.end);
    if (allCompleted) {
      this._finishDownload();
      return;
    }

    // Find the segment with the largest remaining bytes
    let largestSegment = null;
    let maxRemaining = 0;

    for (const seg of this.segments) {
      if (seg.status === 'downloading') {
        const remaining = seg.end - seg.current;
        if (remaining > maxRemaining && remaining >= this.dynamicSplitThreshold) {
          maxRemaining = remaining;
          largestSegment = seg;
        }
      }
    }

    if (largestSegment) {
      const remaining = largestSegment.end - largestSegment.current;
      const splitPoint = largestSegment.current + Math.floor(remaining / 2);
      const originalEnd = largestSegment.end;

      // Adjust original segment boundary
      largestSegment.end = splitPoint;

      // Create new sub-segment for idle thread
      const newSegment = {
        id: this.segments.length,
        start: splitPoint + 1,
        current: splitPoint + 1,
        end: originalEnd,
        total: (originalEnd - (splitPoint + 1) + 1),
        downloaded: 0,
        status: 'pending'
      };

      this.segments.push(newSegment);
      this.emit('dynamic-split', { originalId: largestSegment.id, newSegmentId: newSegment.id });
      this._downloadSegment(newSegment);
    }
  }

  _startSingleStreamDownload() {
    const parsedUrl = new URL(this.url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const fileStream = fs.createWriteStream(this.filePath, { flags: 'w' });
    this.fileDescriptor = fileStream;

    const req = client.get(this.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PandaDownloader/1.0',
        ...this.headers
      }
    }, (res) => {
      res.on('data', (chunk) => {
        this.downloadedBytes += chunk.length;
        if (this.segments[0]) {
          this.segments[0].downloaded += chunk.length;
          this.segments[0].current += chunk.length;
        }
        this.emit('progress', this.getProgress());
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        this._finishDownload();
      });

      fileStream.on('error', (err) => {
        this.status = 'error';
        this.emit('error', err);
        this._cleanup();
      });
    });

    req.on('error', (err) => {
      this.status = 'error';
      this.emit('error', err);
      this._cleanup();
    });

    this.activeRequests.push(req);
  }

  _finishDownload() {
    this.status = 'completed';
    this.downloadedBytes = this.totalBytes > 0 ? this.totalBytes : this.downloadedBytes;
    this._cleanup();

    if (fs.existsSync(this.metadataPath)) {
      try {
        fs.unlinkSync(this.metadataPath);
      } catch (e) {}
    }

    this.emit('completed', {
      id: this.id,
      filePath: this.filePath,
      filename: this.filename,
      totalBytes: this.downloadedBytes
    });
  }

  pause() {
    if (this.status !== 'downloading') return;
    this.status = 'paused';
    this._abortActiveRequests();
    this._saveMetadata();
    this._cleanup();
    this.emit('status-changed', { status: this.status });
  }

  resume() {
    if (this.status !== 'paused') return;
    this.start();
  }

  cancel() {
    this.status = 'cancelled';
    this._abortActiveRequests();
    this._cleanup();

    if (fs.existsSync(this.filePath)) {
      try { fs.unlinkSync(this.filePath); } catch (e) {}
    }
    if (fs.existsSync(this.metadataPath)) {
      try { fs.unlinkSync(this.metadataPath); } catch (e) {}
    }

    this.emit('status-changed', { status: this.status });
  }

  _abortActiveRequests() {
    this.activeRequests.forEach(req => {
      try { req.destroy(); } catch (e) {}
    });
    this.activeRequests = [];
  }

  _startSpeedMonitor() {
    if (this.speedTimer) clearInterval(this.speedTimer);
    this.lastBytes = this.downloadedBytes;

    this.speedTimer = setInterval(() => {
      const bytesInSecond = this.downloadedBytes - this.lastBytes;
      this.speed = Math.max(0, bytesInSecond);
      this.lastBytes = this.downloadedBytes;
      this.emit('speed', { speed: this.speed, progress: this.getProgress() });
    }, 1000);
  }

  _cleanup() {
    if (this.speedTimer) {
      clearInterval(this.speedTimer);
      this.speedTimer = null;
    }
    if (this.fileDescriptor && typeof this.fileDescriptor === 'number') {
      try {
        fs.closeSync(this.fileDescriptor);
      } catch (e) {}
      this.fileDescriptor = null;
    }
    this._abortActiveRequests();
  }

  getProgress() {
    const isCompleted = this.status === 'completed';
    const total = this.totalBytes || 0;
    const downloaded = isCompleted && total > 0 ? total : this.downloadedBytes;
    const percent = isCompleted 
      ? 100 
      : (total > 0 ? Math.min(100, (downloaded / total) * 100) : 0);
    
    return {
      id: this.id,
      status: this.status,
      filename: this.filename,
      downloadedBytes: downloaded,
      totalBytes: total,
      percent: parseFloat(percent.toFixed(2)),
      speed: isCompleted ? 0 : this.speed,
      supportsRange: this.supportsRange,
      segments: this.segments.map(s => ({
        id: s.id,
        start: s.start,
        current: s.current,
        end: s.end,
        total: s.total,
        downloaded: isCompleted ? s.total : s.downloaded,
        percent: isCompleted ? 100 : (s.total > 0 ? parseFloat(Math.min(100, (s.downloaded / s.total) * 100).toFixed(1)) : 0),
        status: isCompleted ? 'completed' : s.status
      }))
    };
  }

  toJSON() {
    const isCompleted = this.status === 'completed';
    const total = this.totalBytes || 0;
    const downloaded = isCompleted && total > 0 ? total : this.downloadedBytes;
    const percent = isCompleted 
      ? 100 
      : (total > 0 ? parseFloat(Math.min(100, (downloaded / total) * 100).toFixed(2)) : 0);
    return {
      id: this.id,
      url: this.url,
      filename: this.filename,
      filePath: this.filePath,
      status: this.status,
      downloadedBytes: downloaded,
      totalBytes: total,
      percent: percent,
      speed: isCompleted ? 0 : this.speed,
      supportsRange: this.supportsRange,
      error: this.error,
      connectionsCount: this.connectionsCount,
      segments: this.segments
    };
  }
}

module.exports = { DownloadTask };
