// Panda Downloader - Universal IDM-Style Video & Audio Sniffer Content Script

(function() {
  const PORTAL_DOMAINS = /youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|dailymotion\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|twitch\.tv|bilibili\.com/i;
  const isVideoPortal = PORTAL_DOMAINS.test(window.location.hostname);
  let activePanel = null;
  let lastUrl = window.location.href;

  function findActiveMediaContainer() {
    // 1. YouTube specific player detection
    if (window.location.hostname.includes('youtube.com')) {
      const ytPlayer = document.querySelector('#movie_player') || 
                       document.querySelector('.html5-video-player') || 
                       document.querySelector('ytd-player');
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (ytPlayer && video) {
        return { container: ytPlayer, element: video, type: 'video' };
      }
      if (video) {
        return { container: video.parentElement || document.body, element: video, type: 'video' };
      }
    }

    // 2. Generic HTML5 video players on any website
    const videos = Array.from(document.querySelectorAll('video')).filter(v => {
      const r = v.getBoundingClientRect();
      return r.width > 120 && r.height > 80 && window.getComputedStyle(v).display !== 'none';
    });

    const activeVideo = videos.find(v => !v.paused && !v.ended) || videos[0];
    if (activeVideo) {
      return { 
        container: activeVideo.parentElement || document.body, 
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
        container: activeAudio.parentElement || document.body, 
        element: activeAudio, 
        type: 'audio' 
      };
    }

    return null;
  }

  function injectIdmFloatingPanel(mediaInfo) {
    if (!mediaInfo || !mediaInfo.container) return;

    let panel = document.getElementById('panda-idm-video-panel');
    if (panel) {
      // If panel is already inside the current container, just make sure it's visible
      if (panel.parentElement === mediaInfo.container) {
        panel.style.display = 'flex';
        return;
      }
      panel.remove();
    }

    const isAudio = mediaInfo.type === 'audio';
    const label = isAudio ? 'Download Audio' : 'Download this video';
    const logoUrl = chrome.runtime.getURL('icons/icon16.png');

    const getEstimatedSize = (quality, dur) => {
      if (!dur || dur <= 0 || isNaN(dur)) {
        if (quality === '1080p') return '~194 MB';
        if (quality === '720p') return '~90 MB';
        if (quality === '480p') return '~45 MB';
        if (quality === '360p') return '~26 MB';
        if (quality === 'audio') return '~10.5 MB';
        return '';
      }
      if (quality === '1080p') {
        const mb = Math.round(dur * 0.595);
        return `${mb >= 1 ? mb : '< 1'} MB`;
      }
      if (quality === '720p') {
        const mb = Math.round(dur * 0.276);
        return `${mb >= 1 ? mb : '< 1'} MB`;
      }
      if (quality === '480p') {
        const mb = Math.round(dur * 0.138);
        return `${mb >= 1 ? mb : '< 1'} MB`;
      }
      if (quality === '360p') {
        const mb = Math.round(dur * 0.081);
        return `${mb >= 1 ? mb : '< 1'} MB`;
      }
      if (quality === 'audio') {
        const mb = (dur * 0.032).toFixed(1);
        return `${mb} MB`;
      }
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
        <img src="${logoUrl}" style="width: 16px; height: 16px; border-radius: 3px; object-fit: contain; vertical-align: middle;" alt="Panda">
        <span class="panda-idm-label">${label}</span>
        <span class="panda-idm-arrow">▼</span>
      </div>
      <div class="panda-idm-menu" id="panda-dropdown-menu">
        <div class="panda-menu-title">Select Quality / Format:</div>
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

    // Ensure container has relative positioning so absolute top-right sits on the player
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

    // Real-time dynamic size updater when duration metadata loads
    const updateSizes = () => {
      const currentDur = getDuration();
      if (!currentDur || currentDur <= 0) return;
      panel.querySelectorAll('[data-size-quality]').forEach(el => {
        const q = el.getAttribute('data-size-quality');
        el.textContent = getEstimatedSize(q, currentDur);
      });
    };

    if (mediaInfo.element) {
      mediaInfo.element.addEventListener('durationchange', updateSizes);
      mediaInfo.element.addEventListener('loadedmetadata', updateSizes);
      mediaInfo.element.addEventListener('timeupdate', updateSizes, { once: true });
    }

    const triggerBtn = panel.querySelector('#panda-trigger-btn');
    const dropdown = panel.querySelector('#panda-dropdown-menu');

    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      updateSizes();
      dropdown.classList.toggle('show');
    });

    document.addEventListener('click', () => {
      dropdown.classList.remove('show');
    });

    // Handle format click
    panel.querySelectorAll('.panda-menu-item').forEach(item => {
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
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span style="font-size: 14px;">⏳</span><span class="panda-idm-label">Sending to Panda...</span>`;

    let targetUrl = '';
    let targetFilename = '';

    if (isVideoPortal) {
      // Pass clean page URL to yt-dlp
      const cleanTitle = document.title
        .replace(/- YouTube$/i, '')
        .replace(/\| TikTok$/i, '')
        .replace(/\| Vimeo$/i, '')
        .trim() || 'video';
      targetUrl = window.location.href;
      targetFilename = `${cleanTitle.replace(/[\\/:*?"<>|]/g, '_')}.${format}`;
    } else {
      // Generic websites: detect video src or network sniffer stream
      const el = mediaInfo.element;
      if (el) {
        targetUrl = el.currentSrc || el.src || (el.querySelector('source') ? el.querySelector('source').src : '');
      }

      if (!targetUrl || targetUrl.startsWith('blob:') || targetUrl.startsWith('data:')) {
        try {
          const resp = await new Promise(res => {
            chrome.runtime.sendMessage({ action: 'GET_TAB_MEDIA' }, res);
          });
          if (resp && resp.media && resp.media.length > 0) {
            const match = resp.media.find(m => mediaInfo.type === 'audio' ? m.contentType.includes('audio') : (m.contentType.includes('video') || m.url.includes('.mp4') || m.url.includes('.m3u8'))) || resp.media[0];
            if (match) {
              targetUrl = match.url;
              targetFilename = match.filename;
            }
          }
        } catch (e) {}
      }

      if (!targetUrl || targetUrl.startsWith('blob:')) {
        targetUrl = window.location.href;
      }

      if (!targetFilename) {
        try {
          const parsed = new URL(targetUrl);
          targetFilename = parsed.pathname.split('/').filter(Boolean).pop();
        } catch (e) {}
        if (!targetFilename || !targetFilename.includes('.')) {
          const cleanTitle = document.title.replace(/[-|–].*$/, '').trim() || (mediaInfo.type === 'audio' ? 'audio_track' : 'video_stream');
          targetFilename = `${cleanTitle.replace(/[\\/:*?"<>|]/g, '_')}.${format}`;
        }
      }
    }

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
      if (res && res.success) {
        btn.innerHTML = `<span style="color:#10b981; font-size:14px;">✓</span><span class="panda-idm-label" style="color:#10b981;">Added to Panda!</span>`;
        setTimeout(() => { btn.innerHTML = originalText; }, 2500);
      } else {
        alert(res?.error || 'Make sure Panda Downloader desktop app is running!');
        btn.innerHTML = originalText;
      }
    });
  }

  // Periodic scan to inject/reposition on SPA navigation and video changes
  function checkAndInject() {
    const media = findActiveMediaElement();
    if (media) {
      injectIdmFloatingPanel(media);
    }
  }

  // Monitor SPA URL changes (YouTube playlist, history navigation)
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      setTimeout(checkAndInject, 500);
    } else {
      checkAndInject();
    }
  }, 1000);

  // Hook into YouTube navigation events
  window.addEventListener('yt-navigate-finish', () => setTimeout(checkAndInject, 500));
  window.addEventListener('yt-page-data-updated', () => setTimeout(checkAndInject, 500));
  window.addEventListener('popstate', () => setTimeout(checkAndInject, 500));

  // Initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndInject);
  } else {
    checkAndInject();
  }

})();
