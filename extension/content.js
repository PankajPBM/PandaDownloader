// Panda Downloader - Universal IDM-Style Video & Audio Sniffer Content Script
// Automatically detects and overlays accelerated download panels on HTML5 video players, streaming iframes, and media portals.

(function() {
  const isTopFrame = window.top === window.self;

  // Intercept and suppress any extension context invalidation errors
  try {
    window.addEventListener('error', (e) => {
      if (e && e.message && (e.message.includes('Extension context invalidated') || e.message.includes('context invalidated'))) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return true;
      }
    }, true);
  } catch (e) {}

  // Filter out tiny ad iframes and invisible tracking frames
  function shouldRunInCurrentFrame() {
    if (isTopFrame) return true;
    try {
      const w = window.innerWidth || document.documentElement.clientWidth || 0;
      const h = window.innerHeight || document.documentElement.clientHeight || 0;
      if (w < 180 || h < 100) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  if (!shouldRunInCurrentFrame()) return;

  const PORTAL_DOMAINS = /youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|dailymotion\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|twitch\.tv|bilibili\.com/i;
  const isVideoPortal = PORTAL_DOMAINS.test(window.location.hostname);
  let activePanel = null;
  let lastUrl = window.location.href;
  let cachedMediaStreams = [];
  let extensionEnabled = true;

  function isExtensionValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // Load and listen for extension enabled state
  if (isExtensionValid()) {
    try {
      chrome.storage.local.get(['extensionEnabled'], (res) => {
        if (res && typeof res.extensionEnabled === 'boolean') {
          extensionEnabled = res.extensionEnabled;
          if (!extensionEnabled) {
            document.querySelectorAll('#panda-idm-video-panel').forEach(p => p.remove());
          }
        }
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.extensionEnabled) {
          extensionEnabled = changes.extensionEnabled.newValue;
          if (!extensionEnabled) {
            document.querySelectorAll('#panda-idm-video-panel').forEach(p => p.remove());
          } else {
            checkAndInject();
          }
        }
      });
    } catch (e) {}

    // Listen for live media stream detections and toggle commands from background
    try {
      chrome.runtime.onMessage.addListener((message) => {
        if (message && message.action === 'TOGGLE_EXTENSION') {
          extensionEnabled = Boolean(message.enabled);
          if (!extensionEnabled) {
            document.querySelectorAll('#panda-idm-video-panel').forEach(p => p.remove());
          } else {
            checkAndInject();
          }
          return;
        }

        if (message && message.action === 'MEDIA_DETECTED' && Array.isArray(message.media)) {
          if (!extensionEnabled) return;
          cachedMediaStreams = message.media;
          if (typeof updateActivePanelStreams === 'function') {
            updateActivePanelStreams(message.media);
          }
        }
      });
    } catch (e) {}
  }

  let updateActivePanelStreams = null;

  // Poll background for intercepted streams
  function fetchTabMedia(callback) {
    if (!isExtensionValid() || !extensionEnabled) return;
    try {
      chrome.runtime.sendMessage({ action: 'GET_TAB_MEDIA' }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp && resp.media) {
          cachedMediaStreams = resp.media;
          if (callback) callback(resp.media);
        }
      });
    } catch (e) {}
  }

  function findActiveMediaElement() {
    const root = document.body || document.documentElement;

    // 1. YouTube specific player detection
    if (window.location.hostname.includes('youtube.com')) {
      const ytPlayer = document.querySelector('#movie_player') || 
                       document.querySelector('.html5-video-player') || 
                       document.querySelector('ytd-player') ||
                       document.querySelector('#player-container');
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (ytPlayer && video) return { container: ytPlayer, element: video, type: 'video', isYouTube: true };
      if (video) return { container: root, element: video, type: 'video', isFixedBody: true };
    }

    // 2. HTML5 <video> elements in current frame (TikTok, Reels, Twitter, etc.)
    const vh = window.innerHeight || 800;
    const videos = Array.from(document.querySelectorAll('video')).filter(v => {
      const r = v.getBoundingClientRect();
      const style = window.getComputedStyle(v);
      return (r.width > 60 || v.videoWidth > 60) && style.display !== 'none' && style.visibility !== 'hidden';
    });
    
    // On TikTok/Reels, find currently active/playing video in the visible screen area
    const activeVideo = videos.find(v => {
      const r = v.getBoundingClientRect();
      return !v.paused && !v.ended && r.bottom > 80 && r.top < vh - 80;
    }) || videos.find(v => !v.paused && !v.ended) || videos.find(v => {
      const r = v.getBoundingClientRect();
      return r.bottom > 80 && r.top < vh - 80;
    }) || videos[0];

    if (activeVideo) {
      return { 
        container: root, 
        element: activeVideo, 
        type: 'video',
        isFixedBody: true 
      };
    }

    // 3. Audio players on any website
    const audios = Array.from(document.querySelectorAll('audio')).filter(a => {
      return window.getComputedStyle(a).display !== 'none';
    });
    const activeAudio = audios.find(a => !a.paused && !a.ended) || audios[0];
    if (activeAudio) {
      return { 
        container: root, 
        element: activeAudio, 
        type: 'audio',
        isFixedBody: true 
      };
    }

    // 4. Video Iframes in top frame (movie streaming portals like moviesflixpro.info, embed players, etc.)
    if (isTopFrame) {
      const iframes = Array.from(document.querySelectorAll('iframe')).filter(f => {
        try {
          const r = f.getBoundingClientRect();
          const s = window.getComputedStyle(f);
          return r.width >= 240 && r.height >= 130 && s.display !== 'none' && s.visibility !== 'hidden';
        } catch (e) {
          return false;
        }
      });

      const videoIframe = iframes.find(f => {
        const str = ((f.src || '') + (f.id || '') + (f.className || '')).toLowerCase();
        return /player|embed|video|stream|movie|play|watch|m3u8/i.test(str);
      }) || (cachedMediaStreams.length > 0 ? iframes[0] : null);

      if (videoIframe) {
        return {
          container: root,
          element: videoIframe,
          type: 'iframe',
          isFixedBody: true
        };
      }
    }

    return null;
  }

  function injectIdmFloatingPanel(mediaInfo) {
    if (!mediaInfo || !mediaInfo.element || !isExtensionValid()) return;
    const root = document.body || document.documentElement;
    const targetParent = mediaInfo.isYouTube && mediaInfo.container 
      ? mediaInfo.container 
      : (document.fullscreenElement || root);

    let panel = document.getElementById('panda-idm-video-panel');

    const updatePanelCoordinates = () => {
      if (!panel || !panel.isConnected || !mediaInfo.element) return;
      const el = mediaInfo.element;
      const rect = el.getBoundingClientRect();

      // If video is scrolled off screen or hidden, hide panel
      if (rect.width < 50 || rect.height < 50 || rect.bottom <= 20 || rect.top >= (window.innerHeight || 800) - 20) {
        panel.style.display = 'none';
        return;
      }

      panel.style.display = 'flex';

      if (document.fullscreenElement) {
        panel.style.setProperty('position', 'absolute', 'important');
        panel.style.setProperty('top', '16px', 'important');
        panel.style.setProperty('right', '16px', 'important');
        panel.style.setProperty('left', 'auto', 'important');
      } else if (mediaInfo.isFixedBody) {
        panel.style.setProperty('position', 'fixed', 'important');
        const pWidth = panel.offsetWidth || 185;
        const topPos = Math.max(12, Math.round(rect.top + 14));
        const leftPos = Math.max(12, Math.min((window.innerWidth || 1200) - pWidth - 14, Math.round(rect.right - pWidth - 14)));
        panel.style.setProperty('top', `${topPos}px`, 'important');
        panel.style.setProperty('left', `${leftPos}px`, 'important');
        panel.style.setProperty('right', 'auto', 'important');
      } else {
        panel.style.setProperty('position', 'absolute', 'important');
        panel.style.setProperty('top', '14px', 'important');
        panel.style.setProperty('right', '14px', 'important');
        panel.style.setProperty('left', 'auto', 'important');
      }
    };

    if (panel) {
      if (panel.getAttribute('data-video-url') === currentVideoUrl && panel.parentElement === targetParent && root && root.contains(panel)) {
        panel.style.display = 'flex';
        updatePanelCoordinates();
        return;
      }
      panel.remove();
      panel = null;
    }

    const isAudio = mediaInfo.type === 'audio';
    const label = isAudio ? 'Download Audio' : 'Download this video';

    const formatBytes = (bytes) => {
      if (!bytes || isNaN(bytes) || bytes <= 0) return '';
      if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
      } else if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      } else {
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
      }
    };

    let currentVideoUrl = window.location.href;
    try {
      const u = new URL(window.location.href);
      if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
        const v = u.searchParams.get('v');
        if (v) currentVideoUrl = `https://www.youtube.com/watch?v=${v}`;
      }
    } catch (e) {}

    // Extract YouTube formats and exact stream byte sizes
    const parseStreamingData = (sd) => {
      if (!sd || !sd.adaptiveFormats) return null;
      let bestAudioBytes = 0;
      const audioFormats = sd.adaptiveFormats.filter(f => f.mimeType && f.mimeType.startsWith('audio/'));
      for (const a of audioFormats) {
        const sz = parseInt(a.contentLength, 10) || (a.approxDurationMs && a.bitrate ? Math.round(a.bitrate * parseInt(a.approxDurationMs, 10) / 8000) : 0);
        if (sz > bestAudioBytes) bestAudioBytes = sz;
      }

      const videoMap = new Map();
      for (const f of sd.adaptiveFormats) {
        if (!f.mimeType || !f.mimeType.startsWith('video/') || !f.height) continue;
        const h = f.height;
        const fSize = parseInt(f.contentLength, 10) || (f.approxDurationMs && f.bitrate ? Math.round(f.bitrate * parseInt(f.approxDurationMs, 10) / 8000) : 0);
        const existing = videoMap.get(h);
        const exSize = existing ? (parseInt(existing.contentLength, 10) || 0) : 0;
        if (!existing || (f.mimeType.includes('mp4') && !existing.mimeType.includes('mp4')) || fSize > exSize) {
          videoMap.set(h, f);
        }
      }

      const getMeta = (h) => {
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

      const sortedHeights = Array.from(videoMap.keys()).sort((a, b) => b - a);
      if (sortedHeights.length === 0) return null;

      const formats = [];
      for (const h of sortedHeights) {
        const f = videoMap.get(h);
        const meta = getMeta(h);
        let totalBytes = parseInt(f.contentLength, 10) || (f.approxDurationMs && f.bitrate ? Math.round(f.bitrate * parseInt(f.approxDurationMs, 10) / 8000) : 0);
        if (totalBytes > 0) totalBytes += bestAudioBytes;
        formats.push({
          quality: `${h}p`,
          height: h,
          badge: meta.badge,
          label: meta.label,
          format: 'mp4',
          size: totalBytes,
          sizeFormatted: formatBytes(totalBytes)
        });
      }

      formats.push({
        quality: 'audio',
        height: 0,
        badge: 'AUDIO',
        label: 'Extract Audio (MP3)',
        format: 'mp3',
        size: bestAudioBytes,
        sizeFormatted: formatBytes(bestAudioBytes),
        isAudio: true
      });

      return formats;
    };

    const getYouTubeInPageFormats = () => {
      try {
        const u = new URL(window.location.href);
        const currentV = u.searchParams.get('v');
        for (const s of document.scripts) {
          const txt = s.textContent || '';
          if (txt.includes('ytInitialPlayerResponse')) {
            const m = txt.match(/ytInitialPlayerResponse\s*=\s*({.+?});(?:\s*var|\s*<\/script|\s*$)/s);
            if (m && m[1]) {
              const resp = JSON.parse(m[1]);
              // Prevent stale data from previous video on SPA navigation
              if (currentV && resp.videoDetails && resp.videoDetails.videoId && resp.videoDetails.videoId !== currentV) {
                return null;
              }
              return parseStreamingData(resp.streamingData);
            }
          }
        }
      } catch (e) {}
      return null;
    };

    // Query active live YouTube player in page context via MAIN world bridge
    const requestYouTubePlayerResponse = () => {
      try {
        window.postMessage({ type: 'PANDA_REQUEST_YT_DATA' }, '*');
      } catch (e) {}
    };

    const probedFormatsMap = new Map();
    const fetchProbedFormats = (videoUrl, callback) => {
      if (probedFormatsMap.has(videoUrl)) return callback(probedFormatsMap.get(videoUrl));
      try {
        chrome.runtime.sendMessage({ action: 'PROBE_VIDEO_FORMATS', url: videoUrl }, (res) => {
          if (chrome.runtime.lastError) return;
          if (res && res.success && res.data && res.data.formats && res.data.formats.length > 0) {
            probedFormatsMap.set(videoUrl, res.data.formats);
            callback(res.data.formats);
          }
        });
      } catch (e) {}
    };

    panel = document.createElement('div');
    panel.id = 'panda-idm-video-panel';
    panel.className = 'panda-idm-panel';
    panel.setAttribute('data-video-url', currentVideoUrl);
    panel.innerHTML = `
      <div class="panda-idm-header" id="panda-trigger-btn" title="Download media with Panda Downloader">
        <span style="font-size: 15px; line-height: 1; margin-right: 2px;">🐼</span>
        <span class="panda-idm-label">${label}</span>
        <span class="panda-idm-arrow">▼</span>
      </div>
      <div class="panda-idm-menu" id="panda-dropdown-menu">
        <div id="panda-streams-container"></div>
        <div class="panda-menu-title">${isVideoPortal ? 'Available Formats & Sizes:' : 'Download Options:'}</div>
        <div id="panda-formats-container">
          <div class="panda-menu-loading">
            <span style="font-size: 13px;">⏳</span> Detecting all available formats...
          </div>
        </div>
      </div>
    `;

    // Mount panel safely without touching TikTok or HTML5 video player DOM containers
    if (mediaInfo.isYouTube && mediaInfo.container && mediaInfo.container !== root) {
      const containerStyle = window.getComputedStyle(mediaInfo.container);
      if (containerStyle.position === 'static') {
        mediaInfo.container.style.position = 'relative';
      }
      panel.style.setProperty('position', 'absolute', 'important');
      panel.style.setProperty('top', '12px', 'important');
      panel.style.setProperty('right', '12px', 'important');
      panel.style.setProperty('left', 'auto', 'important');
      mediaInfo.container.appendChild(panel);
    } else {
      targetParent.appendChild(panel);
      updatePanelCoordinates();
      window.addEventListener('scroll', updatePanelCoordinates, { passive: true });
      window.addEventListener('resize', updatePanelCoordinates, { passive: true });
    }
    activePanel = panel;

    // Prevent clicks inside panel from bubbling to video players (prevents video pausing on TikTok/Reels)
    panel.addEventListener('click', (e) => { e.stopPropagation(); });
    panel.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    panel.addEventListener('pointerdown', (e) => { e.stopPropagation(); });

    const triggerBtn = panel.querySelector('#panda-trigger-btn');
    const dropdown = panel.querySelector('#panda-dropdown-menu');
    const streamsContainer = panel.querySelector('#panda-streams-container');
    const formatsContainer = panel.querySelector('#panda-formats-container');

    const getDefaultVideoFormats = () => {
      const isAudio = mediaInfo.type === 'audio';
      if (isAudio) {
        return [
          { quality: 'audio', badge: 'AUDIO', label: 'Extract Audio (MP3)', format: 'mp3', isAudio: true }
        ];
      }

      const list = [];
      const el = mediaInfo.element;
      const directSrc = el && (el.currentSrc || el.src);
      if (directSrc && !directSrc.startsWith('blob:') && !directSrc.startsWith('data:')) {
        list.push({
          quality: 'direct',
          badge: 'DIRECT',
          label: 'Direct Playing Stream (Fast MP4)',
          format: 'mp4',
          directUrl: directSrc
        });
      }

      list.push(
        { quality: 'best', badge: 'HD', label: 'Best Quality Available (MP4)', format: 'mp4' },
        { quality: '1080p', badge: '1080p', label: 'Full HD Video (MP4)', format: 'mp4' },
        { quality: '720p', badge: '720p', label: 'Standard HD Video (MP4)', format: 'mp4' },
        { quality: 'audio', badge: 'AUDIO', label: 'Audio Only Track (MP3)', format: 'mp3', isAudio: true }
      );

      return list;
    };

    const renderFormatsList = (formats) => {
      if (!formats || formats.length === 0) return;
      const html = formats.map(f => `
        <div class="panda-menu-item panda-format-option" data-quality="${f.quality}" data-format="${f.format || 'mp4'}" data-size="${f.size || 0}" ${f.directUrl ? `data-direct-url="${encodeURIComponent(f.directUrl)}"` : ''}>
          <span class="badge-res ${f.isAudio ? 'audio' : (f.quality === 'direct' ? 'stream' : '')}">${f.badge}</span>
          <span class="item-name">${f.label}</span>
          ${f.sizeFormatted ? `<span class="item-size ${f.isAudio ? 'audio' : ''}">${f.sizeFormatted}</span>` : ''}
        </div>
      `).join('');

      formatsContainer.innerHTML = html;

      formatsContainer.querySelectorAll('.panda-format-option').forEach(item => {
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          const quality = item.getAttribute('data-quality');
          const format = item.getAttribute('data-format');
          const size = parseInt(item.getAttribute('data-size') || '0', 10);
          const directUrlEnc = item.getAttribute('data-direct-url');
          dropdown.classList.remove('show');

          if (directUrlEnc) {
            const directUrl = decodeURIComponent(directUrlEnc);
            const cleanTitle = (document.title || 'video_download').replace(/[\\/:*?"<>|]/g, '_');
            await sendDownloadRequest(directUrl, `${cleanTitle}.mp4`, 'direct', 'mp4', triggerBtn, size);
          } else {
            await executeDownload(mediaInfo, quality, format, triggerBtn, size);
          }
        });
      });
    };

    // Populate intercepted network streams with real formatted byte sizes and 1-click download buttons
    const renderStreamsList = (streams) => {
      if (!streams || streams.length === 0) {
        streamsContainer.innerHTML = '';
        return;
      }

      const labelEl = panel.querySelector('.panda-idm-label');
      if (labelEl) {
        labelEl.textContent = `${label} (${streams.length})`;
      }

      const itemsHtml = streams.slice(0, 10).map((s) => {
        const isHls = s.url.includes('.m3u8') || (s.contentType && s.contentType.includes('mpegurl'));
        const isAudio = s.contentType && s.contentType.includes('audio');
        const badge = isHls ? 'HLS' : (isAudio ? 'AUDIO' : 'MP4');
        const shortName = s.filename.length > 24 ? s.filename.substring(0, 22) + '...' : s.filename;
        const sizeDisplay = s.size > 0 ? formatBytes(s.size) : (isHls ? 'Adaptive HLS' : 'Stream');
        return `
          <div class="panda-menu-item panda-stream-option stream-item" data-stream-url="${encodeURIComponent(s.url)}" data-stream-name="${encodeURIComponent(s.filename)}" data-stream-size="${s.size || 0}">
            <span class="badge-res ${badge.toLowerCase()}">${badge}</span>
            <div style="display: flex; flex-direction: column; overflow: hidden; flex: 1; min-width: 0; margin: 0 4px;">
              <span class="item-name" title="${s.filename}" style="font-weight: 700; color: #f8fafc;">${shortName}</span>
              <span style="font-size: 10.5px; color: #94a3b8;">${isAudio ? 'Audio Track' : 'Video Stream'} · ${sizeDisplay}</span>
            </div>
            <button class="stream-btn-dl" title="Download with Panda Downloader">↓ Download</button>
          </div>
        `;
      }).join('');

      streamsContainer.innerHTML = `
        <div class="panda-menu-title" style="color: #10b981; font-weight: 700;">⚡ Detected Media Streams (${streams.length}):</div>
        ${itemsHtml}
        <div class="panda-menu-divider"></div>
      `;

      // Attach click listeners to stream items
      streamsContainer.querySelectorAll('.panda-stream-option').forEach(item => {
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          dropdown.classList.remove('show');
          const streamUrl = decodeURIComponent(item.getAttribute('data-stream-url'));
          let streamName = decodeURIComponent(item.getAttribute('data-stream-name'));
          const streamSize = parseInt(item.getAttribute('data-stream-size') || '0', 10);

          if (/\.(m3u8|mpd)(\?.*)?$/i.test(streamUrl) || streamName.endsWith('.m3u8') || streamName.endsWith('.mpd')) {
            const pageTitle = (document.title || 'video_stream').replace(/[-|–].*$/, '').trim().replace(/[\\/:*?"<>|]/g, '_');
            const cleanStreamName = streamName.replace(/\.(m3u8|mpd)(\?.*)?$/i, '');
            streamName = `${pageTitle}_${cleanStreamName}.mp4`;
          }

          await sendDownloadRequest(streamUrl, streamName, 'direct', 'mp4', triggerBtn, streamSize);
        });
      });
    };

    updateActivePanelStreams = (streams) => {
      renderStreamsList(streams);
    };

    let latestVideoFormats = null;

    // 1. Initial immediate formats from in-page YouTube response or standard presets (0ms)
    const inPageFormats = getYouTubeInPageFormats();
    renderFormatsList(inPageFormats || getDefaultVideoFormats());

    // Listen for live YouTube player responses from main-world bridge
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'PANDA_YT_STREAMING_DATA' && event.data.streamingData) {
        try {
          const u = new URL(window.location.href);
          const currentV = u.searchParams.get('v');
          if (currentV && event.data.videoId && event.data.videoId !== currentV) {
            return;
          }
        } catch (e) {}
        const parsed = parseStreamingData(event.data.streamingData);
        if (parsed && parsed.length > 0) {
          latestVideoFormats = parsed;
          renderFormatsList(parsed);
        }
      }
    });

    if (isVideoPortal && window.location.hostname.includes('youtube.com')) {
      requestYouTubePlayerResponse();
    }

    // 2. Initial stream render if already cached
    renderStreamsList(cachedMediaStreams);

    // Toggle dropdown & fetch fresh media list
    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      dropdown.classList.toggle('show');

      // Ensure dropdown always has options immediately
      const currentFormats = latestVideoFormats || inPageFormats || getDefaultVideoFormats();
      renderFormatsList(currentFormats);

      if (isVideoPortal && window.location.hostname.includes('youtube.com')) {
        requestYouTubePlayerResponse();
      }

      fetchTabMedia((freshStreams) => {
        if (freshStreams && freshStreams.length > 0) {
          cachedMediaStreams = freshStreams;
          renderStreamsList(freshStreams);
        }
      });

      fetchProbedFormats(currentVideoUrl, (freshFormats) => {
        if (freshFormats && freshFormats.length > 0) {
          renderFormatsList(freshFormats);
        }
      });
    });

    document.addEventListener('click', () => {
      dropdown.classList.remove('show');
    });
  }

  async function executeDownload(mediaInfo, quality, format, btn, expectedSize = 0) {
    let targetUrl = window.location.href;

    if (window.location.hostname.includes('youtube.com') || window.location.hostname.includes('youtu.be')) {
      try {
        const u = new URL(window.location.href);
        const v = u.searchParams.get('v');
        if (v) targetUrl = `https://www.youtube.com/watch?v=${v}`;
      } catch (e) {}
    }

    const cleanTitle = document.title
      .replace(/- YouTube$/i, '')
      .replace(/\| TikTok$/i, '')
      .replace(/\| Vimeo$/i, '')
      .replace(/[-|–].*$/, '')
      .trim() || (mediaInfo && mediaInfo.type === 'audio' ? 'audio_track' : 'video_download');

    const targetFilename = `${cleanTitle.replace(/[\\/:*?"<>|]/g, '_')}.${format || 'mp4'}`;

    await sendDownloadRequest(targetUrl, targetFilename, quality, format, btn, expectedSize);
  }

  async function sendDownloadRequest(targetUrl, targetFilename, quality, format, btn, expectedSize = 0) {
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span style="font-size: 14px;">⏳</span><span class="panda-idm-label">Sending to Panda...</span>`;

    try {
      chrome.runtime.sendMessage({
        action: 'DOWNLOAD_WITH_PANDA',
        payload: {
          action: 'ADD_DOWNLOAD',
          url: targetUrl,
          filename: targetFilename,
          quality: quality,
          format: format,
          fileSize: expectedSize || 0,
          headers: {
            'Referer': window.location.href,
            'User-Agent': navigator.userAgent
          }
        }
      }, (res) => {
        if (chrome.runtime.lastError) {
          alert('Make sure Panda Downloader desktop app is running!');
          btn.innerHTML = originalText;
          return;
        }
        if (res && res.success) {
          btn.innerHTML = `<span style="color:#10b981; font-size:14px;">✓</span><span class="panda-idm-label" style="color:#10b981;">Added to Panda!</span>`;
          setTimeout(() => { btn.innerHTML = originalText; }, 2500);
        } else {
          alert(res?.error || 'Make sure Panda Downloader desktop app is running!');
          btn.innerHTML = originalText;
        }
      });
    } catch (e) {
      alert('Make sure Panda Downloader desktop app is running!');
      btn.innerHTML = originalText;
    }
  }

  let observer = null;
  let scanInterval = null;

  function checkAndInject() {
    if (!isExtensionValid()) {
      try { if (observer) observer.disconnect(); } catch (e) {}
      try { if (scanInterval) clearInterval(scanInterval); } catch (e) {}
      return;
    }
    if (!extensionEnabled) {
      document.querySelectorAll('#panda-idm-video-panel').forEach(p => p.remove());
      return;
    }
    try {
      fetchTabMedia();
      const media = findActiveMediaElement();
      if (media) {
        injectIdmFloatingPanel(media);
      }
    } catch (e) {}
  }

  let injectDebounce = null;
  function debouncedCheckAndInject() {
    if (injectDebounce) clearTimeout(injectDebounce);
    injectDebounce = setTimeout(checkAndInject, 350);
  }

  // Real-time MutationObserver
  try {
    observer = new MutationObserver(() => {
      if (!isExtensionValid()) {
        try { if (observer) observer.disconnect(); } catch (e) {}
        try { if (scanInterval) clearInterval(scanInterval); } catch (e) {}
        return;
      }
      if (!extensionEnabled) {
        document.querySelectorAll('#panda-idm-video-panel').forEach(p => p.remove());
        return;
      }
      const media = document.querySelector('video') || document.querySelector('iframe');
      const panel = document.getElementById('panda-idm-video-panel');
      const root = document.body || document.documentElement;
      if (media && (!panel || !root || !root.contains(panel))) {
        debouncedCheckAndInject();
      }
    });
    const targetNode = document.documentElement || document.body;
    if (targetNode) {
      observer.observe(targetNode, { childList: true, subtree: true });
    }
  } catch (e) {}

  // Periodic scan for SPA navigations
  scanInterval = setInterval(() => {
    if (!isExtensionValid()) {
      try { if (observer) observer.disconnect(); } catch (e) {}
      try { if (scanInterval) clearInterval(scanInterval); } catch (e) {}
      return;
    }
    if (!extensionEnabled) {
      document.querySelectorAll('#panda-idm-video-panel').forEach(p => p.remove());
      return;
    }
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      cachedMediaStreams = [];
      document.querySelectorAll('#panda-idm-video-panel').forEach(p => p.remove());
      setTimeout(checkAndInject, 300);
      setTimeout(checkAndInject, 800);
    } else {
      checkAndInject();
    }
  }, 1000);

  // Fullscreen support so download button stays visible when entering fullscreen
  document.addEventListener('fullscreenchange', () => {
    setTimeout(checkAndInject, 200);
  });

  const handleNavUrlChange = () => {
    if (!extensionEnabled) {
      document.querySelectorAll('#panda-idm-video-panel').forEach(p => p.remove());
      return;
    }
    lastUrl = window.location.href;
    cachedMediaStreams = [];
    document.querySelectorAll('#panda-idm-video-panel').forEach(p => p.remove());
    setTimeout(checkAndInject, 300);
    setTimeout(checkAndInject, 800);
  };

  // YouTube & SPA navigation events
  window.addEventListener('yt-navigate-finish', handleNavUrlChange);
  window.addEventListener('yt-page-data-updated', handleNavUrlChange);
  window.addEventListener('popstate', handleNavUrlChange);

  // Initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndInject);
  } else {
    checkAndInject();
  }
})();
