document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const isYouTube = tab.url && /youtube\.com\/watch|youtu\.be/i.test(tab.url);
  const isVideoPortal = tab.url && /vimeo\.com|tiktok\.com|dailymotion\.com|facebook\.com|twitch\.tv/i.test(tab.url);

  chrome.runtime.sendMessage({ action: 'GET_TAB_MEDIA', tabId: tab.id }, (response) => {
    if (chrome.runtime.lastError) {
      response = { media: [] };
    }
    const listEl = document.getElementById('list');
    const countEl = document.getElementById('media-count');

    let rawMedia = (response && response.media) || [];

    // Filter out tiny sound effects and image thumbnails
    let filtered = rawMedia.filter(m => {
      const isSoundFx = m.filename.includes('failure.mp3') || m.filename.includes('open.mp3') || m.filename.includes('success.mp3') || m.filename.includes('no_input.mp3');
      const isImage = m.contentType && m.contentType.startsWith('image/');
      const isTiny = m.size > 0 && m.size < 150000 && !m.url.includes('.m3u8') && !m.url.includes('.mpd');
      return !isSoundFx && !isImage && !isTiny;
    });

    const displayList = [];

    // If on YouTube or video portal, add all 4 primary resolution options with MB sizes
    if (isYouTube || isVideoPortal) {
      const cleanTitle = (tab.title || 'Video Stream')
        .replace(/- YouTube$/i, '')
        .replace(/\| TikTok$/i, '')
        .replace(/\| Vimeo$/i, '')
        .trim();

      let videoUrl = tab.url;
      try {
        const u = new URL(tab.url);
        if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
          const v = u.searchParams.get('v');
          if (v) videoUrl = `https://www.youtube.com/watch?v=${v}`;
        }
      } catch (e) {}

      displayList.push({
        url: videoUrl,
        filename: `${cleanTitle}.mp4`,
        format: 'mp4',
        quality: '1080p',
        displayType: '1080p Full HD Video (MP4)',
        sizeStr: '~194 MB',
        isPrimary: true
      });

      displayList.push({
        url: videoUrl,
        filename: `${cleanTitle}.mp4`,
        format: 'mp4',
        quality: '720p',
        displayType: '720p HD Video (MP4)',
        sizeStr: '~90 MB',
        isPrimary: true
      });

      displayList.push({
        url: videoUrl,
        filename: `${cleanTitle}.mp4`,
        format: 'mp4',
        quality: '480p',
        displayType: '480p Standard Video (MP4)',
        sizeStr: '~45 MB',
        isPrimary: true
      });

      displayList.push({
        url: videoUrl,
        filename: `${cleanTitle}.mp3`,
        format: 'mp3',
        quality: 'audio',
        displayType: 'Extract Audio (MP3)',
        sizeStr: '~10.5 MB',
        isPrimary: true
      });
    }

    // Add other sniffed media
    filtered.forEach(item => {
      const sizeStr = item.size > 0 ? `${(item.size / (1024 * 1024)).toFixed(1)} MB` : 'Stream';
      const typeStr = item.contentType ? item.contentType.split('/')[1] || item.contentType : 'media';
      displayList.push({
        url: item.url,
        filename: item.filename,
        format: item.filename.split('.').pop() || 'bin',
        quality: 'best',
        displayType: typeStr.toUpperCase(),
        sizeStr: sizeStr,
        isPrimary: false
      });
    });

    countEl.textContent = `${displayList.length} Available`;

    if (displayList.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No video or media streams detected yet.<br>Play a video to capture it with Panda Downloader.</div>';
      return;
    }

    listEl.innerHTML = '';

    displayList.forEach((item) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'media-item';

      itemEl.innerHTML = `
        <div class="media-info">
          <div class="media-title" title="${item.filename}">${item.filename}</div>
          <div class="media-meta">${item.displayType} • ${item.sizeStr}</div>
        </div>
        <button class="download-btn">
          <span>⬇</span> Download
        </button>
      `;

      const btn = itemEl.querySelector('.download-btn');
      btn.addEventListener('click', () => {
        btn.textContent = 'Sending...';
        btn.disabled = true;

        chrome.runtime.sendMessage({
          action: 'DOWNLOAD_WITH_PANDA',
          payload: {
            action: 'ADD_DOWNLOAD',
            url: item.url,
            filename: item.filename,
            format: item.format,
            quality: item.quality,
            headers: {
              'Referer': tab.url,
              'User-Agent': navigator.userAgent
            }
          }
        }, (res) => {
          if (chrome.runtime.lastError) {
            btn.textContent = 'Failed';
            alert('Make sure Panda Downloader desktop app is running!');
            btn.disabled = false;
            return;
          }
          if (res && res.success) {
            btn.textContent = '✓ Added!';
            btn.style.background = '#059669';
          } else {
            btn.textContent = 'Failed';
            alert(res ? res.error : 'Failed to reach Panda Downloader');
            btn.disabled = false;
          }
        });
      });

      listEl.appendChild(itemEl);
    });
  });
});
