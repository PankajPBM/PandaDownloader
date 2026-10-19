// Panda Downloader - Universal IDM-Style Video & Audio Sniffer Content Script

(function() {
  const PORTAL_DOMAINS = /youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|dailymotion\.com|facebook\.com|instagram\.com|x\.com|twitter\.com|twitch\.tv|bilibili\.com/i;
  const isVideoPortal = PORTAL_DOMAINS.test(window.location.hostname);
  let activeOverlay = null;

  function findActiveMediaElement() {
    if (isVideoPortal && window.location.hostname.includes('youtube.com')) {
      const ytPlayer = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      return { container: ytPlayer || (video && video.parentElement), element: video, type: 'video' };
    }

    // Scan for video elements on any website
    const videos = Array.from(document.querySelectorAll('video')).filter(v => {
      const r = v.getBoundingClientRect();
      return r.width > 160 && r.height > 90 && window.getComputedStyle(v).display !== 'none';
    });

    const playingVideo = videos.find(v => !v.paused && !v.ended && v.currentTime > 0) || videos[0];
    if (playingVideo) {
      return { container: playingVideo.parentElement, element: playingVideo, type: 'video' };
    }

    // Scan for audio elements
    const audios = Array.from(document.querySelectorAll('audio')).filter(a => {
      return window.getComputedStyle(a).display !== 'none';
    });
    const playingAudio = audios.find(a => !a.paused && !a.ended) || audios[0];
    if (playingAudio) {
      return { container: playingAudio.parentElement, element: playingAudio, type: 'audio' };
    }

    return { container: null, element: null, type: null };
  }

  function createIdmFloatingPanel(mediaInfo) {
    if (document.getElementById('panda-idm-video-panel')) return;

    const isAudio = mediaInfo.type === 'audio';
    const label = isAudio ? 'Download Audio' : 'Download this video';

    const panel = document.createElement('div');
    panel.id = 'panda-idm-video-panel';
    panel.className = 'panda-idm-panel';
    panel.innerHTML = `
      <div class="panda-idm-header" id="panda-trigger-btn">
        <span class="panda-idm-logo">🐼</span>
        <span class="panda-idm-label">${label}</span>
        <span class="panda-idm-arrow">▼</span>
      </div>
      <div class="panda-idm-menu" id="panda-dropdown-menu">
        <div class="panda-menu-title">Select Quality / Format:</div>
        ${!isAudio ? `
        <div class="panda-menu-item" data-quality="1080p" data-format="mp4">
          <span class="badge-res">1080p</span>
          <span class="item-name">Full HD Video (MP4)</span>
        </div>
        <div class="panda-menu-item" data-quality="720p" data-format="mp4">
          <span class="badge-res">720p</span>
          <span class="item-name">HD Video (MP4)</span>
        </div>
        <div class="panda-menu-item" data-quality="480p" data-format="mp4">
          <span class="badge-res">480p</span>
          <span class="item-name">Standard Video (MP4)</span>
        </div>
        <div class="panda-menu-divider"></div>
        ` : ''}
        <div class="panda-menu-item" data-quality="audio" data-format="mp3">
          <span class="badge-res audio">AUDIO</span>
          <span class="item-name">Extract Audio (MP3)</span>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    activeOverlay = panel;

    const triggerBtn = panel.querySelector('#panda-trigger-btn');
    const dropdown = panel.querySelector('#panda-dropdown-menu');

    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      dropdown.classList.toggle('show');
    });

    document.addEventListener('click', () => {
      dropdown.classList.remove('show');
    });

    // Handle quality / format selection
    panel.querySelectorAll('.panda-menu-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const quality = item.getAttribute('data-quality');
        const format = item.getAttribute('data-format');
        dropdown.classList.remove('show');

        await executeDownload(mediaInfo, quality, format, triggerBtn);
      });
    });

    function updatePosition() {
      const current = findActiveMediaElement();
      if (!current.element) {
        panel.style.display = 'none';
        return;
      }

      const rect = (current.container || current.element).getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
        panel.style.display = 'none';
        return;
      }

      panel.style.display = 'flex';
      panel.style.top = `${Math.max(10, rect.top + window.scrollY + 12)}px`;
      panel.style.left = `${Math.max(10, rect.right + window.scrollX - 220)}px`;
    }

    window.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition, { passive: true });
    setInterval(updatePosition, 1000);
    updatePosition();
  }

  async function executeDownload(mediaInfo, quality, format, btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span class="panda-idm-logo">⏳</span><span class="panda-idm-label">Sending to Panda...</span>`;

    let targetUrl = '';
    let targetFilename = '';

    if (isVideoPortal) {
      // For YouTube and supported video portals, pass the clean webpage URL so yt-dlp extracts best streams
      const cleanTitle = document.title
        .replace(/- YouTube$/i, '')
        .replace(/\| TikTok$/i, '')
        .replace(/\| Vimeo$/i, '')
        .trim() || 'video';
      targetUrl = window.location.href;
      targetFilename = `${cleanTitle.replace(/[\\/:*?"<>|]/g, '_')}.${format}`;
    } else {
      // For generic websites, find the direct media stream or query background sniffer
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
        btn.innerHTML = `<span class="panda-idm-logo">✅</span><span class="panda-idm-label">Added to Panda!</span>`;
        setTimeout(() => { btn.innerHTML = originalText; }, 2500);
      } else {
        alert(res?.error || 'Make sure Panda Downloader desktop app is running!');
        btn.innerHTML = originalText;
      }
    });
  }

  // Periodic scan for video or audio players across the DOM
  setInterval(() => {
    const media = findActiveMediaElement();
    if (media.element) {
      createIdmFloatingPanel(media);
    }
  }, 1500);

})();
