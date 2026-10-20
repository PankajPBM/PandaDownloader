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
        '--progress-template', 'PANDA:%(progress.downloaded_bytes)s:%(progress.total_bytes,progress.total_bytes_estimate)s:%(progress.speed)s:%(progress._percent_str)s:%(progress.eta)s',
        '-N', String(this.connectionsCount),
        '-P', this.saveDirectory,
        '-o', '%(title)s.%(ext)s'
      ];

      if (isAudioOnly) {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
      } else if (this.quality && this.quality !== 'best') {
        const heightMatch = String(this.quality).match(/(\d+)/);
        if (heightMatch) {
          const h = parseInt(heightMatch[1], 10);
          args.push('-f', `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`);
        } else {
          args.push('-f', 'bestvideo+bestaudio/best');
        }
      } else {
        args.push('-f', 'bestvideo+bestaudio/best');
      }

      args.push('--encoding', 'utf-8');
      args.push(this.url);

      const spawnEnv = {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONLEGACYWINDOWSSTDIO: 'utf-8'
      };

      this.process = spawn(YTDLP_PATH, args, { windowsHide: true, env: spawnEnv });

      const emitLiveProgress = () => {
        if (this.totalBytes > 0 && this.downloadedBytes > 0 && this.percent <= 0) {
          this.percent = Math.min(99, (this.downloadedBytes / this.totalBytes) * 100);
        }
        if (this.totalBytes > 0 && this.speed > 0 && (!this.eta || this.eta <= 0)) {
          const remaining = Math.max(0, this.totalBytes - this.downloadedBytes);
          this.eta = Math.round(remaining / this.speed);
        }
        this.segments.forEach((seg, i) => {
          const jitter = ((i * 3) % 7) - 3;
          seg.percent = Math.min(100, Math.max(0, Math.floor(this.percent + jitter)));
        });
        const prog = this.getProgress();
        this.emit('progress', prog);
        this.emit('speed', { speed: this.speed, progress: prog });
      };

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
              const etaSec = parseInt(parts[5] || '0', 10) || 0;

              if (spd > 0) this.speed = spd;
              if (etaSec > 0) this.eta = etaSec;

              if (this.streamPhase === 1) {
                if (down > 0) this.videoDownloaded = down;
                if (total > 0) this.videoTotal = total;
                this.percent = pct > 0 ? (pct * 0.88) : this.percent;
                this.downloadedBytes = down;
                this.totalBytes = this.videoTotal;
              } else if (this.streamPhase === 2) {
                if (down > 0) this.audioDownloaded = down;
                if (total > 0) this.audioTotal = total;
                this.percent = pct > 0 ? (88 + (pct * 0.10)) : this.percent;
                this.downloadedBytes = this.videoDownloaded + down;
                this.totalBytes = this.videoTotal + this.audioTotal;
              } else {
                if (down > 0) this.downloadedBytes = down;
                if (total > 0) this.totalBytes = total;
                if (pct > 0) this.percent = pct;
              }

              emitLiveProgress();
            }
          } else if (trimmed.startsWith('[download]') && trimmed.includes('%')) {
            // Regex fallback for standard yt-dlp download lines
            const m = trimmed.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+)\s*(\w+)\s+at\s+([\d.]+)\s*(\w+\/s)(?:\s+ETA\s+([\d:]+))?/i);
            if (m) {
              const pct = parseFloat(m[1]) || 0;
              const sizeVal = parseFloat(m[2]) || 0;
              const sizeUnit = (m[3] || '').toLowerCase();
              const spdVal = parseFloat(m[4]) || 0;
              const spdUnit = (m[5] || '').toLowerCase();

              const unitMult = sizeUnit.includes('g') ? 1073741824 : (sizeUnit.includes('m') ? 1048576 : 1024);
              const totalBytes = Math.round(sizeVal * unitMult);
              const spdMult = spdUnit.includes('m') ? 1048576 : 1024;
              const speedBytes = Math.round(spdVal * spdMult);

              if (totalBytes > 0) this.totalBytes = totalBytes;
              if (speedBytes > 0) this.speed = speedBytes;
              if (pct > 0) {
                this.percent = Math.min(99, pct);
                this.downloadedBytes = Math.round(this.totalBytes * (pct / 100));
              }

              emitLiveProgress();
            }
          } else if (trimmed.includes('Destination:')) {
            const match = trimmed.match(/Destination:\s*(.+)$/);
            if (match && match[1]) {
              const dest = match[1].trim();
              const resolved = path.isAbsolute(dest) ? dest : path.join(this.saveDirectory, path.basename(dest));
              this.filePath = resolved;
              this.filename = fixMojibake(path.basename(resolved));

              const lower = dest.toLowerCase();
              if (lower.includes('.f140') || lower.endsWith('.m4a') || lower.endsWith('.opus') || (this.videoTotal > 0 && this.streamPhase === 1)) {
                this.streamPhase = 2;
              }
            }
          } else if (trimmed.includes('[Merger]') || trimmed.includes('Merging formats into')) {
            this.streamPhase = 3;
            this.percent = 99;
            this.speed = 0;
            const match = trimmed.match(/Merging formats into ["']?([^"']+)["']?/i);
            if (match && match[1]) {
              const dest = match[1].trim();
              const resolved = path.isAbsolute(dest) ? dest : path.join(this.saveDirectory, path.basename(dest));
              this.filePath = resolved;
              this.filename = fixMojibake(path.basename(resolved));
            }
            emitLiveProgress();
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

          this.status = 'completed';
          this.percent = 100;
          this.speed = 0;
          if (finalPath) this.filePath = finalPath;

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
            totalBytes: this.totalBytes,
            percent: 100
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
      const spawnEnv = {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONLEGACYWINDOWSSTDIO: 'utf-8'
      };
      const probe = spawn(YTDLP_PATH, ['--encoding', 'utf-8', '--js-runtimes', 'node', '--no-playlist', '--print', 'title', this.url], { windowsHide: true, env: spawnEnv });
      let out = '';
      probe.stdout.on('data', d => out += d);
      probe.on('close', () => {
        resolve(fixMojibake(out.trim()));
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
    const isCompleted = this.status === 'completed';
    const total = this.totalBytes || 0;
    const downloaded = isCompleted && total > 0 ? total : this.downloadedBytes;
    const percent = isCompleted ? 100 : parseFloat(this.percent.toFixed(1));
    return {
      id: this.id,
      status: this.status,
      filename: this.filename,
      downloadedBytes: downloaded,
      totalBytes: total,
      percent: percent,
      speed: isCompleted ? 0 : this.speed,
      supportsRange: true,
      segments: this.segments,
      phase: isCompleted ? 'completed' : (this.streamPhase === 3 ? 'merging' : 'downloading')
    };
  }

  toJSON() {
    const isCompleted = this.status === 'completed';
    const total = this.totalBytes || 0;
    const downloaded = isCompleted && total > 0 ? total : this.downloadedBytes;
    const percent = isCompleted ? 100 : parseFloat(this.percent.toFixed(1));
    return {
      id: this.id,
      url: this.url,
      filename: this.filename,
      filePath: this.filePath,
      status: this.status,
      downloadedBytes: downloaded,
      totalBytes: total,
      speed: isCompleted ? 0 : this.speed,
      percent: percent,
      supportsRange: true,
      error: this.error,
      connectionsCount: this.connectionsCount,
      segments: this.segments,
      phase: isCompleted ? 'completed' : (this.streamPhase === 3 ? 'merging' : 'downloading')
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

const probeCache = new Map();

function probeMedia(url) {
  return new Promise((resolve) => {
    const cleanUrl = cleanVideoUrl(url);
    if (!cleanUrl) return resolve({ title: '', duration: 0, formats: [] });

    const cached = probeCache.get(cleanUrl);
    if (cached && (Date.now() - cached.timestamp < 10 * 60 * 1000)) {
      return resolve(cached.data);
    }

    const spawnEnv = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONLEGACYWINDOWSSTDIO: 'utf-8'
    };

    const args = [
      '--encoding', 'utf-8',
      '--js-runtimes', 'node',
      '--no-playlist',
      '--skip-download',
      '-J',
      cleanUrl
    ];

    let stdoutData = '';
    let settled = false;

    const proc = spawn(YTDLP_PATH, args, { windowsHide: true, env: spawnEnv });

    proc.stdout.on('data', (chunk) => {
      stdoutData += chunk;
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch (e) {}
      if (result && result.formats && result.formats.length > 0) {
        probeCache.set(cleanUrl, { timestamp: Date.now(), data: result });
      }
      resolve(result);
    };

    proc.on('close', () => {
      if (settled) return;
      try {
        const rawJson = stdoutData.trim().replace(/^\uFEFF/, '');
        if (!rawJson) return finish({ title: '', duration: 0, formats: [] });
        const data = JSON.parse(rawJson);
        const title = fixMojibake(data.title || '');
        const duration = data.duration || 0;
        const allFormats = data.formats || [];

        let bestAudioSize = 0;
        const audioStreams = allFormats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
        for (const a of audioStreams) {
          const sz = a.filesize || a.filesize_approx || (duration > 0 && a.tbr ? Math.round(a.tbr * 1024 * duration / 8) : 0);
          if (sz > bestAudioSize) bestAudioSize = sz;
        }
        if (bestAudioSize === 0 && duration > 0) {
          bestAudioSize = Math.round(128 * 1024 * duration / 8);
        }

        const heightMap = new Map();
        for (const f of allFormats) {
          if (!f.height || f.vcodec === 'none') continue;
          const h = f.height;
          const existing = heightMap.get(h);
          const fSize = f.filesize || f.filesize_approx || (duration > 0 && f.tbr ? Math.round(f.tbr * 1024 * duration / 8) : 0);
          const exSize = existing ? (existing.filesize || existing.filesize_approx || 0) : 0;

          if (!existing || (f.ext === 'mp4' && existing.ext !== 'mp4') || (fSize > exSize)) {
            heightMap.set(h, f);
          }
        }

        const getMetaForHeight = (h) => {
          if (h >= 4320) return { badge: '8K', label: '8K Ultra HD (MP4)' };
          if (h >= 2160) return { badge: '4K', label: '4K Ultra HD (MP4)' };
          if (h >= 1440) return { badge: '2K', label: '2K Quad HD (MP4)' };
          if (h >= 1080) return { badge: '1080p', label: 'Full HD Video (MP4)' };
          if (h >= 720) return { badge: '720p', label: 'HD Video (MP4)' };
          if (h >= 480) return { badge: '480p', label: 'Standard Video (MP4)' };
          if (h >= 360) return { badge: '360p', label: 'Medium Video (MP4)' };
          if (h >= 240) return { badge: '240p', label: 'Small Video (MP4)' };
          return { badge: `${h}p`, label: `${h}p Video (MP4)` };
        };

        const sortedHeights = Array.from(heightMap.keys()).sort((a, b) => b - a);
        const formats = [];

        for (const h of sortedHeights) {
          const f = heightMap.get(h);
          const meta = getMetaForHeight(h);
          let rawSize = f.filesize || f.filesize_approx || 0;
          if (rawSize === 0 && duration > 0 && f.tbr) {
            rawSize = Math.round(f.tbr * 1024 * duration / 8);
          }
          if (f.acodec === 'none' && rawSize > 0) {
            rawSize += bestAudioSize;
          }

          let sizeStr = '';
          if (rawSize > 0) {
            if (rawSize >= 1024 * 1024 * 1024) {
              sizeStr = `${(rawSize / (1024 * 1024 * 1024)).toFixed(2)} GB`;
            } else {
              sizeStr = `${Math.round(rawSize / (1024 * 1024))} MB`;
            }
          }

          formats.push({
            quality: `${h}p`,
            height: h,
            badge: meta.badge,
            label: meta.label,
            format: 'mp4',
            size: rawSize,
            sizeFormatted: sizeStr
          });
        }

        let audioSizeStr = '';
        if (bestAudioSize > 0) {
          audioSizeStr = `${(bestAudioSize / (1024 * 1024)).toFixed(1)} MB`;
        }

        formats.push({
          quality: 'audio',
          height: 0,
          badge: 'AUDIO',
          label: 'Extract Audio (MP3)',
          format: 'mp3',
          size: bestAudioSize,
          sizeFormatted: audioSizeStr,
          isAudio: true
        });

        finish({
          title,
          duration,
          formats
        });
      } catch (err) {
        finish({ title: '', duration: 0, formats: [] });
      }
    });

    proc.on('error', () => finish({ title: '', duration: 0, formats: [] }));

    setTimeout(() => {
      finish({ title: '', duration: 0, formats: [] });
    }, 12000);
  });
}

module.exports = { VideoDownloadTask, isVideoPortalUrl, probeMedia };
