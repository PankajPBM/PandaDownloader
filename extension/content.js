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

  function isExtensionValid() {
    try {
      return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // Poll background for intercepted streams
  function fetchTabMedia(callback) {
    if (!isExtensionValid()) return;
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
      if (ytPlayer && video) return { container: ytPlayer, element: video, type: 'video' };
      if (video) return { container: video.parentElement || root, element: video, type: 'video' };
    }

    // 2. HTML5 <video> elements in current frame
    const videos = Array.from(document.querySelectorAll('video')).filter(v => {
      const r = v.getBoundingClientRect();
      const style = window.getComputedStyle(v);
      return (r.width > 60 || v.videoWidth > 60) && style.display !== 'none' && style.visibility !== 'hidden';
    });
    const activeVideo = videos.find(v => !v.paused && !v.ended) || videos[0];
    if (activeVideo) {
      return { 
        container: activeVideo.parentElement || root, 
        element: activeVideo, 
        type: 'video' 
      };
    }

    // 3. Audio players on any website
    const audios = Array.from(document.querySelectorAll('audio')).filter(a => {
      return window.getComputedStyle(a).display !== 'none';
    });
    const activeAudio = audios.find(a => !a.paused && !a.ended) || audios[0];
    if (activeAudio) {
      return { 
        container: activeAudio.parentElement || root, 
        element: activeAudio, 
        type: 'audio' 
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
          container: videoIframe.parentElement || root,
          element: videoIframe,
          type: 'iframe'
        };
      }
    }

    return null;
  }

  function injectIdmFloatingPanel(mediaInfo) {
    if (!mediaInfo || !mediaInfo.container || !isExtensionValid()) return;
    const root = document.body || document.documentElement;

    let panel = document.getElementById('panda-idm-video-panel');
    if (panel) {
      if (panel.parentElement === mediaInfo.container && root && root.contains(panel)) {
        panel.style.display = 'flex';
        return;
      }
      panel.remove();
    }

    const isAudio = mediaInfo.type === 'audio';
    const label = isAudio ? 'Download Audio' : 'Download this video';

    const getEstimatedSize = (quality, dur) => {
      if (!dur || dur <= 0 || isNaN(dur)) {
        if (quality === '1080p') return '~194 MB';
        if (quality === '720p') return '~90 MB';
        if (quality === '480p') return '~45 MB';
        if (quality === '360p') return '~26 MB';
        if (quality === 'audio') return '~10.5 MB';
        return '';
      }
      if (quality === '1080p') return `${Math.max(1, Math.round(dur * 0.595))} MB`;
      if (quality === '720p') return `${Math.max(1, Math.round(dur * 0.276))} MB`;
      if (quality === '480p') return `${Math.max(1, Math.round(dur * 0.138))} MB`;
      if (quality === '360p') return `${Math.max(1, Math.round(dur * 0.081))} MB`;
      if (quality === 'audio') return `${(dur * 0.032).toFixed(1)} MB`;
      return '';
    };

    const getDuration = () => {
      const el = mediaInfo.element;
      if (el && el.duration && !isNaN(el.duration) && el.duration > 0) return el.duration;
      const ytPlayer = document.querySelector('#movie_player');
      if (ytPlayer && typeof ytPlayer.getDuration === 'function') {
        const d = ytPlayer.getDuration();
        if (d && !isNaN(d) && d > 0) return d;
      }
      return 0;
    };

    const dur = getDuration();

    panel = document.createElement('div');
    panel.id = 'panda-idm-video-panel';
    panel.className = 'panda-idm-panel';
    panel.innerHTML = `
      <div class="panda-idm-header" id="panda-trigger-btn" title="Download media with Panda Downloader">
        <span style="font-size: 15px; line-height: 1; margin-right: 2px;">🐼</span>
        <span class="panda-idm-label">${label}</span>
        <span class="panda-idm-arrow">▼</span>
      </div>
      <div class="panda-idm-menu" id="panda-dropdown-menu">
        <div id="panda-streams-container"></div>
        <div class="panda-menu-title">${isVideoPortal ? 'Select Quality / Format:' : 'Download Options:'}</div>
        ${!isAudio ? `
        <div class="panda-menu-item" data-quality="1080p" data-format="mp4">
          <span class="badge-res">1080p</span>
          <span class="item-name">Full HD Video (MP4)</span>
          <span class="item-size" data-size-quality="1080p">${getEstimatedSize('1080p', dur)}</span>
        </div>
        <div class="panda-menu-item" data-quality="720p" data-format="mp4">
          <span class="badge-res">720p</span>
          <span class="item-name">HD Video (MP4)</span>
          <span class="item-size" data-size-quality="720p">${getEstimatedSize('720p', dur)}</span>
        </div>
        <div class="panda-menu-item" data-quality="480p" data-format="mp4">
          <span class="badge-res">480p</span>
          <span class="item-name">Standard Video (MP4)</span>
          <span class="item-size" data-size-quality="480p">${getEstimatedSize('480p', dur)}</span>
        </div>
        <div class="panda-menu-item" data-quality="360p" data-format="mp4">
          <span class="badge-res">360p</span>
          <span class="item-name">Low Bitrate (MP4)</span>
          <span class="item-size" data-size-quality="360p">${getEstimatedSize('360p', dur)}</span>
        </div>
        <div class="panda-menu-divider"></div>
        ` : ''}
        <div class="panda-menu-item" data-quality="audio" data-format="mp3">
          <span class="badge-res audio">AUDIO</span>
          <span class="item-name">Extract Audio (MP3)</span>
          <span class="item-size audio" data-size-quality="audio">${getEstimatedSize('audio', dur)}</span>
        </div>
      </div>
    `;

    // Ensure container has relative positioning so absolute top-right sits right on the player
    const containerStyle = window.getComputedStyle(mediaInfo.container);
    if (containerStyle.position === 'static') {
      mediaInfo.container.style.position = 'relative';
    }

    panel.style.position = 'absolute';
    panel.style.top = '12px';
    panel.style.right = '12px';
    panel.style.zIndex = '2147483647';
    panel.style.display = 'flex';

    mediaInfo.container.appendChild(panel);
    activePanel = panel;

    const triggerBtn = panel.querySelector('#panda-trigger-btn');
    const dropdown = panel.querySelector('#panda-dropdown-menu');
    const streamsContainer = panel.querySelector('#panda-streams-container');

    // Populate intercepted network streams from background sniffer
    const renderStreamsList = (streams) => {
      if (!streams || streams.length === 0) {
        streamsContainer.innerHTML = '';
        return;
      }
      const itemsHtml = streams.slice(0, 6).map((s, idx) => {
        const isHls = s.url.includes('.m3u8') || s.contentType.includes('mpegurl');
        const badge = isHls ? 'HLS' : (s.contentType.includes('audio') ? 'AUDIO' : 'STREAM');
        const shortName = s.filename.length > 22 ? s.filename.substring(0, 20) + '...' : s.filename;
        return `
          <div class="panda-menu-item panda-stream-option" data-stream-url="${encodeURIComponent(s.url)}" data-stream-name="${encodeURIComponent(s.filename)}">
            <span class="badge-res ${badge.toLowerCase()}">${badge}</span>
            <span class="item-name" title="${s.filename}">${shortName}</span>
            <span class="item-size">Captured</span>
          </div>
        `;
      }).join('');

      streamsContainer.innerHTML = `
        <div class="panda-menu-title" style="color: #10b981; font-weight: 700;">⚡ Detected Video Streams (${streams.length}):</div>
        ${itemsHtml}
        <div class="panda-menu-divider"></div>
      `;

      // Attach click listeners to stream items
      streamsContainer.querySelectorAll('.panda-stream-option').forEach(item => {
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          dropdown.classList.remove('show');
          const streamUrl = decodeURIComponent(item.getAttribute('data-stream-url'));
          const streamName = decodeURIComponent(item.getAttribute('data-stream-name'));
          await sendDownloadRequest(streamUrl, streamName, 'best', 'mp4', triggerBtn);
        });
      });
    };

    // Initial stream render if already cached
    renderStreamsList(cachedMediaStreams);

    // Toggle dropdown & fetch fresh media list
    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      fetchTabMedia((freshStreams) => {
        renderStreamsList(freshStreams);
      });
      dropdown.classList.toggle('show');
    });

    document.addEventListener('click', () => {
      dropdown.classList.remove('show');
    });

    // Handle standard quality clicks
    panel.querySelectorAll('.panda-menu-item:not(.panda-stream-option)').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const quality = item.getAttribute('data-quality');
        const format = item.getAttribute('data-format');
        dropdown.classList.remove('show');
        await executeDownload(mediaInfo, quality, format, triggerBtn);
      });
    });
  }

  async function executeDownload(mediaInfo, quality, format, btn) {
    let targetUrl = '';
    let targetFilename = '';

    if (isVideoPortal) {
      const cleanTitle = document.title
        .replace(/- YouTube$/i, '')
        .replace(/\| TikTok$/i, '')
        .replace(/\| Vimeo$/i, '')
        .trim();

      if (window.location.hostname.includes('youtube.com') || window.location.hostname.includes('youtu.be')) {
        try {
          const u = new URL(window.location.href);
          const v = u.searchParams.get('v');
          targetUrl = v ? `https://www.youtube.com/watch?v=${v}` : window.location.href;
        } catch (e) {
          targetUrl = window.location.href;
        }
      } else {
        targetUrl = window.location.href;
      }
      targetFilename = `${cleanTitle.replace(/[\\/:*?"<>|]/g, '_')}.${format}`;
    } else {
      // 1. Check if background sniffer has intercepted media streams
      if (cachedMediaStreams.length > 0) {
        const best = cachedMediaStreams.find(m => quality === 'audio' ? m.contentType.includes('audio') : (m.contentType.includes('video') || m.url.includes('.m3u8') || m.url.includes('.mp4'))) || cachedMediaStreams[0];
        if (best) {
          targetUrl = best.url;
          targetFilename = best.filename;
        }
      }

      // 2. Fallback to HTML5 video element source
      if (!targetUrl && mediaInfo.element) {
        const el = mediaInfo.element;
        targetUrl = el.currentSrc || el.src || (el.querySelector && el.querySelector('source') ? el.querySelector('source').src : '');
      }

      // 3. Fallback to webpage URL if blob / data URL
      if (!targetUrl || targetUrl.startsWith('blob:') || targetUrl.startsWith('data:')) {
        targetUrl = window.location.href;
      }

      if (!targetFilename || !targetFilename.includes('.')) {
        const cleanTitle = document.title.replace(/[-|–].*$/, '').trim() || (mediaInfo.type === 'audio' ? 'audio_track' : 'video_download');
        targetFilename = `${cleanTitle.replace(/[\\/:*?"<>|]/g, '_')}.${format}`;
      }
    }

    await sendDownloadRequest(targetUrl, targetFilename, quality, format, btn);
  }

  async function sendDownloadRequest(targetUrl, targetFilename, quality, format, btn) {
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
    try {
      fetchTabMedia();
      const media = findActiveMediaElement();
      if (media) {
        injectIdmFloatingPanel(media);
      }
    } catch (e) {}
  }

  // Real-time MutationObserver
  try {
    observer = new MutationObserver(() => {
      if (!isExtensionValid()) {
        try { if (observer) observer.disconnect(); } catch (e) {}
        try { if (scanInterval) clearInterval(scanInterval); } catch (e) {}
        return;
      }
      const media = document.querySelector('video') || document.querySelector('iframe');
      const panel = document.getElementById('panda-idm-video-panel');
      const root = document.body || document.documentElement;
      if (media && (!panel || !root || !root.contains(panel))) {
        checkAndInject();
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
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      setTimeout(checkAndInject, 300);
      setTimeout(checkAndInject, 800);
    } else {
      checkAndInject();
    }
  }, 1200);

  // Fullscreen support so download button stays visible when entering fullscreen
  document.addEventListener('fullscreenchange', () => {
    setTimeout(checkAndInject, 200);
  });

  // YouTube navigation events
  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(checkAndInject, 300);
    setTimeout(checkAndInject, 900);
  });

  // Initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndInject);
  } else {
    checkAndInject();
  }
})();
