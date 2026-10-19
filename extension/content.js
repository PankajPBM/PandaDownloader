// Panda Downloader - IDM-Style Video & Audio Sniffing Content Script

(function() {
  const isYouTube = window.location.hostname.includes('youtube.com');
  let activeOverlay = null;

  function findActiveVideoPlayer() {
    if (isYouTube) {
      const ytPlayer = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      return { container: ytPlayer || (video && video.parentElement), video };
    }

    const videos = Array.from(document.querySelectorAll('video')).filter(v => {
      const r = v.getBoundingClientRect();
      return r.width > 200 && r.height > 120 && window.getComputedStyle(v).display !== 'none';
    });

    if (videos.length > 0) {
      return { container: videos[0].parentElement, video: videos[0] };
    }
    return { container: null, video: null };
  }

  function createIdmFloatingPanel(player) {
    if (document.getElementById('panda-idm-video-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'panda-idm-video-panel';
    panel.className = 'panda-idm-panel';
    panel.innerHTML = `
      <div class="panda-idm-header" id="panda-trigger-btn">
        <span class="panda-idm-logo">🐼</span>
        <span class="panda-idm-label">Download this video</span>
        <span class="panda-idm-arrow">▼</span>
      </div>
      <div class="panda-idm-menu" id="panda-dropdown-menu">
        <div class="panda-menu-title">Select Quality / Format:</div>
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
        <div class="panda-menu-item" data-quality="360p" data-format="mp4">
          <span class="badge-res">360p</span>
          <span class="item-name">Low Bitrate (MP4)</span>
        </div>
        <div class="panda-menu-divider"></div>
        <div class="panda-menu-item" data-quality="audio" data-format="mp3">
          <span class="badge-res audio">AUDIO</span>
          <span class="item-name">Extract Audio (MP3 / M4A)</span>
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

    // Handle quality selection
    panel.querySelectorAll('.panda-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const quality = item.getAttribute('data-quality');
        const format = item.getAttribute('data-format');
        dropdown.classList.remove('show');

        triggerDownload(quality, format, triggerBtn);
      });
    });

    function updatePosition() {
      const { video, container } = findActiveVideoPlayer();
      if (!video) {
        panel.style.display = 'none';
        return;
      }

      const rect = (container || video).getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
        panel.style.display = 'none';
        return;
      }

      panel.style.display = 'flex';
      panel.style.top = `${Math.max(10, rect.top + window.scrollY + 14)}px`;
      panel.style.left = `${Math.max(10, rect.right + window.scrollX - 220)}px`;
    }

    window.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition, { passive: true });
    setInterval(updatePosition, 1000);
    updatePosition();
  }

  function triggerDownload(quality, format, btn) {
    const pageTitle = document.title.replace(/- YouTube$/i, '').trim() || 'video_stream';
    const originalText = btn.innerHTML;

    btn.innerHTML = `<span class="panda-idm-logo">⏳</span><span class="panda-idm-label">Sending to Panda...</span>`;

    chrome.runtime.sendMessage({
      action: 'DOWNLOAD_WITH_PANDA',
      payload: {
        action: 'ADD_DOWNLOAD',
        url: window.location.href,
        filename: `${pageTitle.replace(/[\\/:*?"<>|]/g, '_')}.${format}`,
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

  // Periodic scan for video player
  setInterval(() => {
    const { video } = findActiveVideoPlayer();
    if (video) {
      createIdmFloatingPanel(video);
    }
  }, 1500);

})();
