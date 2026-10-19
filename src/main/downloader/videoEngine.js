const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

function findBinary(name) {
  const candidates = [
    path.join(path.dirname(process.execPath || ''), 'bin', name),
    path.join(process.resourcesPath || '', '../bin', name),
    path.join(process.resourcesPath || '', 'bin', name),
    path.join(process.resourcesPath || '', 'app/bin', name),
    path.join(__dirname, '../../../bin', name),
    path.join(process.cwd(), 'bin', name)
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return path.resolve(__dirname, '../../../bin', name);
}

const YTDLP_PATH = findBinary('yt-dlp.exe');
const FFMPEG_PATH = findBinary('ffmpeg.exe');
const FFMPEG_DIR = path.dirname(FFMPEG_PATH);

function cleanVideoUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
      const v = u.searchParams.get('v');
      if (v) {
        return `https://www.youtube.com/watch?v=${v}`;
      }
    }
    return rawUrl;
  } catch (e) {
    return rawUrl;
  }
}

class VideoDownloadTask extends EventEmitter {
  constructor(options) {
    super();
    this.id = options.id || `vtask_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.url = cleanVideoUrl(options.url);
    this.saveDirectory = options.saveDirectory || (
      process.env.USERPROFILE 
        ? path.join(process.env.USERPROFILE, 'Downloads', 'PandaDownloads', 'Video')
        : path.join(process.cwd(), 'downloads', 'Video')
    );
    this.connectionsCount = options.connectionsCount || 16;
    this.format = options.format || 'mp4';
    this.quality = options.quality || 'best';

    this.customFilename = options.filename;
    this.cleanTitle = options.filename ? options.filename.replace(/\.[^/.]+$/, '').trim() : '';
    this.filename = options.filename || 'Panda_Video.mp4';
    this.filePath = '';
    this.totalBytes = 0;
    this.downloadedBytes = 0;
    this.speed = 0;
    this.percent = 0;
    this.status = 'idle'; // 'idle', 'probing', 'downloading', 'completed', 'cancelled', 'error'
    this.supportsRange = true;
    this.error = null;
    this.segments = [];
    this.process = null;

    // Multi-track progress tracking (Video -> Audio -> Merge)
    this.streamPhase = 1; // 1 = video, 2 = audio, 3 = merger
    this.videoDownloaded = 0;
    this.videoTotal = 0;
    this.audioDownloaded = 0;
    this.audioTotal = 0;
  }

  async start() {
    try {
      this.status = 'downloading';
      this.emit('status-changed', { status: this.status, task: this.toJSON() });

      if (!fs.existsSync(this.saveDirectory)) {
        fs.mkdirSync(this.saveDirectory, { recursive: true });
      }

      if (!this.cleanTitle) {
        this.cleanTitle = `Video_${Date.now()}`;
      }

      const isAudioOnly = this.format === 'mp3' || this.quality === 'audio' || /\.(mp3|m4a|wav|aac|flac)$/i.test(this.filename);
      const ext = isAudioOnly ? 'mp3' : 'mp4';
      this.filename = `${this.cleanTitle}.${ext}`;
      this.filePath = path.join(this.saveDirectory, this.filename);

      // Initialize segments to visualize multi-connection fragments
      this.segments = Array.from({ length: this.connectionsCount }, (_, i) => ({
        id: i,
        percent: 0,
        status: 'downloading'
      }));

      // Immediate spawn: No blocking probe; start downloading stream instantly
      const args = [
        '--ffmpeg-location', FFMPEG_DIR,
        '--newline',
        '--no-playlist',
        '--windows-filenames',
        '--no-mtime',
        '--progress-template', 'PANDA:%(progress.downloaded_bytes)s:%(progress.total_bytes)s:%(progress.speed)s:%(progress._percent_str)s',
        '-N', String(this.connectionsCount),
        '-P', this.saveDirectory,
        '-o', '%(title)s.%(ext)s'
      ];

      if (isAudioOnly) {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
      } else if (this.quality === '1080p') {
        args.push('-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best');
      } else if (this.quality === '720p') {
        args.push('-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best');
      } else if (this.quality === '480p') {
        args.push('-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]/best');
      } else if (this.quality === '360p') {
        args.push('-f', 'bestvideo[height<=360]+bestaudio/best[height<=360]/best');
      }

      args.push(this.url);

      this.process = spawn(YTDLP_PATH, args, { windowsHide: true });

      this.process.stdout.on('data', (data) => {
        const text = data.toString();
        const lines = text.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('PANDA:')) {
            const parts = trimmed.split(':');
            if (parts.length >= 5) {
              const down = parseInt(parts[1], 10) || 0;
              const total = parseInt(parts[2], 10) || 0;
              const spd = parseFloat(parts[3]) || 0;
              const pctStr = parts[4].replace('%', '').trim();
              const pct = parseFloat(pctStr) || 0;

              this.speed = spd;

              // Smoothly map video (0%-88%) and audio (88%-98%) tracks
              if (this.streamPhase === 1) {
                this.videoDownloaded = down;
                if (total > 0) this.videoTotal = total;
                this.percent = pct * 0.88;
                this.downloadedBytes = down;
                this.totalBytes = this.videoTotal;
              } else if (this.streamPhase === 2) {
                this.audioDownloaded = down;
                if (total > 0) this.audioTotal = total;
                this.percent = 88 + (pct * 0.10);
                this.downloadedBytes = this.videoDownloaded + down;
                this.totalBytes = this.videoTotal + this.audioTotal;
              }

              // Update segment visualization with dynamic live activity
              this.segments.forEach((seg, i) => {
                const jitter = ((i * 3) % 5) - 2;
                seg.percent = Math.min(100, Math.max(0, this.percent + jitter));
              });

              // Emit progress AND speed events
              const prog = this.getProgress();
              this.emit('progress', prog);
              this.emit('speed', { speed: this.speed, progress: prog });
            }
          } else if (trimmed.includes('Destination:')) {
            const match = trimmed.match(/Destination:\s*(.+)$/);
            if (match && match[1]) {
              const dest = match[1].trim();
              const resolved = path.isAbsolute(dest) ? dest : path.join(this.saveDirectory, path.basename(dest));
              this.filePath = resolved;
              this.filename = path.basename(resolved);

              const lower = dest.toLowerCase();
              // Transition to phase 2 when audio track starts
              if (lower.includes('.f140') || lower.endsWith('.m4a') || lower.endsWith('.opus') || (this.videoTotal > 0 && this.streamPhase === 1)) {
                this.streamPhase = 2;
              }
            }
          } else if (trimmed.includes('[Merger]') || trimmed.includes('Merging formats into')) {
            // Transition to phase 3: ffmpeg muxing
            this.streamPhase = 3;
            this.percent = 99;
            this.speed = 0;
            const match = trimmed.match(/Merging formats into ["']?([^"']+)["']?/i);
            if (match && match[1]) {
              const dest = match[1].trim();
              const resolved = path.isAbsolute(dest) ? dest : path.join(this.saveDirectory, path.basename(dest));
              this.filePath = resolved;
              this.filename = path.basename(resolved);
            }
            const prog = this.getProgress();
            this.emit('progress', prog);
            this.emit('speed', { speed: 0, progress: prog });
          }
        }
      });

      this.process.stderr.on('data', () => {});

      this.process.on('close', (code) => {
        if (code === 0) {
          this.status = 'completed';
          this.percent = 100;
          this.speed = 0;
          this.segments.forEach(s => s.percent = 100);

          // Verify final merged file on disk
          let finalPath = this.filePath;
          if (!finalPath || !fs.existsSync(finalPath)) {
            try {
              if (fs.existsSync(this.saveDirectory)) {
                const files = fs.readdirSync(this.saveDirectory);
                // Exclude partial/temporary files
                const validFiles = files.filter(f => !f.endsWith('.part') && !f.endsWith('.ytdl'));

                // Look for file that matches video/audio extensions and contains words from cleanTitle
                const words = this.cleanTitle.toLowerCase().split(/[\s\-_–|]+/).filter(w => w.length > 2);
                let matched = validFiles.find(f => {
                  const lower = f.toLowerCase();
                  return words.some(w => lower.includes(w)) && !/\.f\d+\./.test(f);
                });

                // Fallback to most recently created/modified file in this folder
                if (!matched && validFiles.length > 0) {
                  const sorted = validFiles.map(f => ({
                    file: f,
                    time: fs.statSync(path.join(this.saveDirectory, f)).mtimeMs
                  })).sort((a, b) => b.time - a.time);
                  matched = sorted[0].file;
                }

                if (matched) {
                  this.filename = matched;
                  finalPath = path.join(this.saveDirectory, matched);
                  this.filePath = finalPath;
                }
              }
            } catch (e) {}
          }

          let finalSize = 0;
          try {
            if (finalPath && fs.existsSync(finalPath)) {
              finalSize = fs.statSync(finalPath).size;
            }
          } catch (e) {}

          if (finalSize > 0) {
            this.totalBytes = finalSize;
            this.downloadedBytes = finalSize;
          } else if (this.totalBytes > 0) {
            this.downloadedBytes = this.totalBytes;
          }

          const prog = this.getProgress();
          prog.status = 'completed';
          prog.percent = 100;
          prog.speed = 0;
          prog.filePath = finalPath;
          prog.filename = this.filename;
          prog.totalBytes = this.totalBytes;
          prog.downloadedBytes = this.downloadedBytes;

          this.emit('progress', prog);
          this.emit('status-changed', { status: 'completed', task: this.toJSON() });
          this.emit('completed', {
            id: this.id,
            filePath: finalPath,
            filename: this.filename,
            totalBytes: this.totalBytes
          });
        } else if (this.status !== 'cancelled') {
          this.status = 'error';
          this.error = `yt-dlp process exited with code ${code}`;
          this.emit('error', new Error(this.error));
        }
      });

      this.process.on('error', (err) => {
        this.status = 'error';
        this.error = err.message;
        this.emit('error', err);
      });

    } catch (err) {
      this.status = 'error';
      this.error = err.message;
      this.emit('error', err);
    }
  }

  _probeTitle() {
    return new Promise((resolve) => {
      const probe = spawn(YTDLP_PATH, ['--js-runtimes', 'node', '--no-playlist', '--print', 'title', this.url], { windowsHide: true });
      let out = '';
      probe.stdout.on('data', d => out += d);
      probe.on('close', () => {
        resolve(out.trim());
      });
      probe.on('error', () => resolve(null));
      setTimeout(() => {
        try { probe.kill(); } catch (e) {}
        resolve(null);
      }, 10000);
    });
  }

  pause() {
    this.cancel();
  }

  resume() {
    this.start();
  }

  cancel() {
    this.status = 'cancelled';
    if (this.process) {
      try { this.process.kill(); } catch (e) {}
      this.process = null;
    }
    this.emit('status-changed', { status: this.status });
  }

  getProgress() {
    return {
      id: this.id,
      status: this.status,
      filename: this.filename,
      downloadedBytes: this.downloadedBytes,
      totalBytes: this.totalBytes,
      percent: parseFloat(this.percent.toFixed(1)),
      speed: this.speed,
      supportsRange: true,
      segments: this.segments,
      phase: this.streamPhase === 3 ? 'merging' : 'downloading'
    };
  }

  toJSON() {
    return {
      id: this.id,
      url: this.url,
      filename: this.filename,
      filePath: this.filePath,
      status: this.status,
      downloadedBytes: this.downloadedBytes,
      totalBytes: this.totalBytes,
      speed: this.speed,
      percent: parseFloat(this.percent.toFixed(1)),
      supportsRange: true,
      error: this.error,
      connectionsCount: this.connectionsCount,
      segments: this.segments,
      phase: this.streamPhase === 3 ? 'merging' : 'downloading'
    };
  }
}

function isVideoPortalUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('youtube.com') ||
    lower.includes('youtu.be') ||
    lower.includes('vimeo.com') ||
    lower.includes('tiktok.com') ||
    lower.includes('dailymotion.com') ||
    lower.includes('facebook.com/watch') ||
    lower.includes('facebook.com/share') ||
    lower.includes('facebook.com/reel') ||
    lower.includes('instagram.com/reel') ||
    lower.includes('instagram.com/tv') ||
    lower.includes('x.com/') ||
    lower.includes('twitter.com/') ||
    lower.includes('twitch.tv') ||
    lower.includes('bilibili.com')
  );
}

module.exports = { VideoDownloadTask, isVideoPortalUrl };
