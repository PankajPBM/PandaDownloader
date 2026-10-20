document.addEventListener('DOMContentLoaded', async () => {
  const toggleEl = document.getElementById('extension-toggle');
  const toggleLabel = document.getElementById('toggle-label');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const countEl = document.getElementById('media-count');
  const listEl = document.getElementById('list');
  const footerStatus = document.getElementById('footer-status');

  let extensionEnabled = true;

  // Sync initial state from storage
  chrome.storage.local.get(['extensionEnabled'], (res) => {
    if (res && typeof res.extensionEnabled === 'boolean') {
      extensionEnabled = res.extensionEnabled;
    }
    updateToggleUI(extensionEnabled);
    if (!extensionEnabled) {
      renderDisabledState();
    }
  });

  function updateToggleUI(enabled) {
    if (toggleEl) toggleEl.checked = enabled;
    if (toggleLabel) {
      toggleLabel.textContent = enabled ? 'ON' : 'OFF';
      toggleLabel.classList.toggle('off', !enabled);
    }
    if (statusDot) {
      statusDot.classList.toggle('inactive', !enabled);
    }
    if (statusText) {
      statusText.textContent = enabled ? 'Interception: Active (ON)' : 'Interception: Paused (OFF)';
    }
    if (footerStatus) {
      footerStatus.textContent = enabled ? 'Active Sniffer' : 'Sniffer Paused';
      footerStatus.style.color = enabled ? '#10b981' : '#64748b';
    }
    if (countEl && !enabled) {
      countEl.textContent = 'Paused';
      countEl.classList.add('off');
    }
  }

  function renderDisabledState() {
    listEl.innerHTML = `
      <div class="disabled-notice">
        <div style="font-size: 20px; margin-bottom: 6px;">⏸️</div>
        <strong>Panda Downloader is Paused</strong>
        <p style="margin: 6px 0 0 0; font-size: 11px; color: #64748b;">
          Automatic download interception and video sniffing are turned off. Regular browser downloads will proceed.
        </p>
        <button class="enable-shortcut-btn" id="resume-btn">Turn ON</button>
      </div>
    `;
    const resumeBtn = document.getElementById('resume-btn');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => {
        setExtensionEnabled(true);
      });
    }
  }

  function setExtensionEnabled(enabled) {
    extensionEnabled = enabled;
    chrome.storage.local.set({ extensionEnabled: enabled });
    chrome.runtime.sendMessage({ action: 'SET_EXTENSION_ENABLED', enabled: enabled });
    // Also notify active tab directly
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'TOGGLE_EXTENSION', enabled }).catch(() => {});
      }
    });
    updateToggleUI(enabled);
    if (!enabled) {
      renderDisabledState();
    } else {
      loadMediaForCurrentTab();
    }
  }

  if (toggleEl) {
    toggleEl.addEventListener('change', (e) => {
      setExtensionEnabled(e.target.checked);
    });
  }

  // Load media items if enabled
  async function loadMediaForCurrentTab() {
    if (!extensionEnabled) {
      renderDisabledState();
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const isYouTube = tab.url && /youtube\.com\/watch|youtu\.be/i.test(tab.url);
    const isVideoPortal = tab.url && /vimeo\.com|tiktok\.com|dailymotion\.com|facebook\.com|twitch\.tv/i.test(tab.url);

    chrome.runtime.sendMessage({ action: 'GET_TAB_MEDIA', tabId: tab.id }, (response) => {
      if (chrome.runtime.lastError) {
        response = { media: [] };
      }

      let rawMedia = (response && response.media) || [];

      // Filter out tiny sound effects and image thumbnails
      let filtered = rawMedia.filter(m => {
        const isSoundFx = m.filename.includes('failure.mp3') || m.filename.includes('open.mp3') || m.filename.includes('success.mp3') || m.filename.includes('no_input.mp3');
        const isImage = m.contentType && m.contentType.startsWith('image/');
        const isTiny = m.size > 0 && m.size < 150000 && !m.url.includes('.m3u8') && !m.url.includes('.mpd');
        return !isSoundFx && !isImage && !isTiny;
      });

      function formatBytes(bytes) {
        if (!bytes || isNaN(bytes) || bytes <= 0) return '';
        if (bytes < 1024 * 1024) {
          return `${Math.round(bytes / 1024)} KB`;
        } else if (bytes < 1024 * 1024 * 1024) {
          return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        } else {
          return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        }
      }

      const displayList = [];

      const renderItems = () => {
        if (!extensionEnabled) return;

        countEl.textContent = `${displayList.length} Available`;
        countEl.classList.remove('off');

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
              <div class="media-meta">${item.displayType}${item.sizeStr ? ` • ${item.sizeStr}` : ''}</div>
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
      };

      // Add sniffed media
      filtered.forEach(item => {
        const sizeStr = item.size > 0 ? formatBytes(item.size) : 'Stream';
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

      // If on video portal, probe real available formats and accurate sizes from daemon
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

        chrome.runtime.sendMessage({ action: 'PROBE_VIDEO_FORMATS', url: videoUrl }, (res) => {
          if (chrome.runtime.lastError) {
            renderItems();
            return;
          }
          if (res && res.success && res.data && res.data.formats && res.data.formats.length > 0) {
            const portalItems = res.data.formats.map(f => ({
              url: videoUrl,
              filename: `${cleanTitle}.${f.format || 'mp4'}`,
              format: f.format || 'mp4',
              quality: f.quality,
              displayType: f.label,
              sizeStr: f.sizeFormatted,
              isPrimary: true
            }));
            displayList.unshift(...portalItems);
            renderItems();
          } else {
            renderItems();
          }
        });
      } else {
        renderItems();
      }
    });
  }

  loadMediaForCurrentTab();
});
