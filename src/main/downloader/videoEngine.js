const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const YTDLP_PATH = path.resolve(__dirname, '../../../bin/yt-dlp.exe');
const FFMPEG_DIR = path.resolve(__dirname, '../../../bin');

class VideoDownloadTask extends EventEmitter {
  constructor(options) {
    super();
    this.id = options.id || `vtask_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.url = options.url;
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
    this.filename = options.filename || 'Fetching title...';
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
      this.status = 'probing';
      this.emit('status-changed', { status: this.status });

      if (!fs.existsSync(this.saveDirectory)) {
        fs.mkdirSync(this.saveDirectory, { recursive: true });
      }

      // Step 1: Probe title using yt-dlp if not provided
      if (!this.cleanTitle) {
        const title = await this._probeTitle();
        if (title) {
          this.cleanTitle = title.replace(/[\\/:*?"<>|]/g, '_').trim();
        } else {
          this.cleanTitle = `Video_${Date.now()}`;
        }
      }

      const isAudioOnly = this.format === 'mp3' || this.quality === 'audio' || /\.(mp3|m4a|wav|aac|flac)$/i.test(this.filename);
      const ext = isAudioOnly ? 'mp3' : 'mp4';
      this.filename = `${this.cleanTitle}.${ext}`;
      this.filePath = path.join(this.saveDirectory, this.filename);

      this.status = 'downloading';
      this.emit('status-changed', { status: this.status, task: this.toJSON() });

      // Initialize segments to visualize multi-connection fragments
      this.segments = Array.from({ length: this.connectionsCount }, (_, i) => ({
        id: i,
        percent: 0,
        status: 'downloading'
      }));

      // Step 2: Spawn yt-dlp with parallel fragment connections, ffmpeg muxing, and clean templates
      const args = [
        '--ffmpeg-location', FFMPEG_DIR,
        '--js-runtimes', 'node',
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
        args.push('-x', '--audio-format', 'mp3');
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
              this.filePath = match[1].trim();
              this.filename = path.basename(this.filePath);
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
          let finalPath = this.filePath || path.join(this.saveDirectory, this.filename);
          if (!fs.existsSync(finalPath)) {
            try {
              const files = fs.readdirSync(this.saveDirectory);
              const found = files.find(f => 
                f.startsWith(this.cleanTitle.substring(0, 25)) && 
                !f.endsWith('.part') && 
                !f.endsWith('.ytdl') &&
                !/\.f\d+\./.test(f)
              );
              if (found) {
                this.filename = found;
                finalPath = path.join(this.saveDirectory, found);
                this.filePath = finalPath;
              }
            } catch (e) {}
          }

          let finalSize = this.totalBytes || this.downloadedBytes;
          try {
            if (fs.existsSync(finalPath)) {
              finalSize = fs.statSync(finalPath).size;
            }
          } catch (e) {}

          this.totalBytes = finalSize;
          this.downloadedBytes = finalSize;

          this.emit('completed', {
            id: this.id,
            filePath: finalPath,
            filename: this.filename,
            totalBytes: finalSize
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
