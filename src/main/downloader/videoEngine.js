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
        ? path.join(process.env.USERPROFILE, 'Downloads', 'PandaDownloads')
        : path.join(process.cwd(), 'downloads')
    );
    this.connectionsCount = options.connectionsCount || 8;

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
  }

  async start() {
    try {
      this.status = 'probing';
      this.emit('status-changed', { status: this.status });

      if (!fs.existsSync(this.saveDirectory)) {
        fs.mkdirSync(this.saveDirectory, { recursive: true });
      }

      // Step 1: Probe title using yt-dlp
      const title = await this._probeTitle();
      if (title) {
        this.filename = `${title.replace(/[\\/:*?"<>|]/g, '_')}.mp4`;
      } else {
        this.filename = `Video_${Date.now()}.mp4`;
      }

      this.filePath = path.join(this.saveDirectory, this.filename);
      this.status = 'downloading';
      this.emit('status-changed', { status: this.status, task: this.toJSON() });

      // Initialize segments to visualize multi-connection fragments
      this.segments = Array.from({ length: this.connectionsCount }, (_, i) => ({
        id: i,
        percent: 0,
        status: 'downloading'
      }));

      // Step 2: Spawn yt-dlp with parallel fragment connections and ffmpeg
      const args = [
        '--ffmpeg-location', FFMPEG_DIR,
        '--js-runtimes', 'node',
        '--newline',
        '--progress-template', 'PANDA:%(progress.downloaded_bytes)s:%(progress.total_bytes)s:%(progress.speed)s:%(progress._percent_str)s',
        '-N', String(this.connectionsCount),
        '-P', this.saveDirectory,
        '-o', '%(title)s.%(ext)s',
        this.url
      ];

      this.process = spawn(YTDLP_PATH, args, { windowsHide: true });

      this.process.stdout.on('data', (data) => {
        const text = data.toString();
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('PANDA:')) {
            const parts = line.split(':');
            if (parts.length >= 5) {
              const down = parseInt(parts[1], 10) || this.downloadedBytes;
              const total = parseInt(parts[2], 10) || this.totalBytes;
              const spd = parseFloat(parts[3]) || 0;
              const pctStr = parts[4].replace('%', '').trim();
              const pct = parseFloat(pctStr) || 0;

              this.downloadedBytes = down;
              if (total > 0) this.totalBytes = total;
              this.speed = spd;
              this.percent = pct;

              // Update segment visualization
              this.segments.forEach((seg) => {
                seg.percent = Math.min(100, pct + (Math.random() * 4 - 2));
              });

              this.emit('progress', this.getProgress());
            }
          } else if (line.includes('Destination:')) {
            const match = line.match(/Destination:\s*(.+)$/);
            if (match && match[1]) {
              this.filePath = match[1].trim();
              this.filename = path.basename(this.filePath);
            }
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

          this.emit('completed', {
            id: this.id,
            filePath: this.filePath || path.join(this.saveDirectory, this.filename),
            filename: this.filename,
            totalBytes: this.totalBytes || this.downloadedBytes
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
      const probe = spawn(YTDLP_PATH, ['--js-runtimes', 'node', '--print', 'title', this.url], { windowsHide: true });
      let out = '';
      probe.stdout.on('data', d => out += d);
      probe.on('close', () => {
        resolve(out.trim());
      });
      probe.on('error', () => resolve(null));
      setTimeout(() => {
        probe.kill();
        resolve(null);
      }, 10000);
    });
  }

  pause() {
    // yt-dlp does not support in-flight pause, but killing it allows resume
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
      percent: parseFloat(this.percent.toFixed(2)),
      speed: this.speed,
      supportsRange: true,
      segments: this.segments
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
      percent: this.percent,
      supportsRange: true,
      error: this.error,
      connectionsCount: this.connectionsCount,
      segments: this.segments
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
    lower.includes('instagram.com/reel') ||
    lower.includes('instagram.com/tv') ||
    lower.includes('x.com/i/status') ||
    lower.includes('twitter.com/i/status')
  );
}

module.exports = { VideoDownloadTask, isVideoPortalUrl };
