document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  chrome.runtime.sendMessage({ action: 'GET_TAB_MEDIA', tabId: tab.id }, (response) => {
    const listEl = document.getElementById('list');
    const countEl = document.getElementById('media-count');

    if (!response || !response.media || response.media.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No media streams detected yet.<br>Play a video or audio to capture it.</div>';
      countEl.textContent = '0 Detected';
      return;
    }

    countEl.textContent = `${response.media.length} Detected`;
    listEl.innerHTML = '';

    response.media.forEach((item) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'media-item';

      const sizeStr = item.size > 0 ? ` • ${(item.size / (1024 * 1024)).toFixed(1)} MB` : '';
      const typeStr = item.contentType ? item.contentType.split('/')[1] || item.contentType : 'media';

      itemEl.innerHTML = `
        <div class="media-info">
          <div class="media-title" title="${item.filename}">${item.filename}</div>
          <div class="media-meta">${typeStr.toUpperCase()}${sizeStr}</div>
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
            headers: {
              'Referer': tab.url
            }
          }
        }, (res) => {
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
