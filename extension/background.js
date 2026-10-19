// In-memory media registry keyed by tabId
const tabMediaMap = new Map();

const MEDIA_MIME_PATTERNS = [
  /^video\//i,
  /^audio\//i,
  /application\/vnd\.apple\.mpegurl/i, // HLS m3u8
  /application\/x-mpegurl/i,
  /application\/dash\+xml/i,          // DASH mpd
  /video\/iso\.segment/i,
  /application\/zip/i,
  /application\/x-rar-compressed/i,
  /application\/x-7z-compressed/i,
  /application\/x-tar/i,
  /application\/pdf/i,
  /application\/octet-stream/i
];

const MEDIA_EXTENSIONS = /\.(mp4|webm|mkv|flv|avi|mov|wmv|ts|m4v|mp3|m4a|aac|wav|ogg|flac|opus|m3u8|mpd|zip|rar|7z|tar|gz|bz2|iso|xz|exe|msi|apk|dmg|pkg|pdf)(\?.*)?$/i;

// Auto-intercept Chrome native downloads for accelerated multi-segment downloading
if (chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener(async (downloadItem) => {
    if (!downloadItem || !downloadItem.url || downloadItem.url.startsWith('blob:') || downloadItem.url.startsWith('data:')) {
      return;
    }

    const isMatch = MEDIA_EXTENSIONS.test(downloadItem.url) || MEDIA_EXTENSIONS.test(downloadItem.filename || '');
    if (isMatch) {
      try {
        // Attempt to pass to Panda Downloader
        const filename = downloadItem.filename ? downloadItem.filename.split(/[\/\\]/).pop() : '';
        const payload = {
          url: downloadItem.finalUrl || downloadItem.url,
          filename: filename,
          referrer: downloadItem.referrer || ''
        };

        const res = await forwardDownloadToPanda(payload);
        if (res && (res.success || res.taskId || res.promptShown)) {
          // Successfully intercepted by Panda Downloader: cancel browser's slow single-thread download
          chrome.downloads.cancel(downloadItem.id).catch(() => {});
          chrome.downloads.erase({ id: downloadItem.id }).catch(() => {});
        }
      } catch (err) {
        console.warn('[Panda Downloader] Daemon not reached, letting browser handle download:', err);
      }
    }
  });
}

// Sniff network responses for video, audio, and large download streams
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;

    let contentType = '';
    let contentLength = 0;
    let contentDisposition = '';

    for (const h of details.responseHeaders || []) {
      const name = h.name.toLowerCase();
      if (name === 'content-type') contentType = h.value || '';
      if (name === 'content-length') contentLength = parseInt(h.value || '0', 10);
      if (name === 'content-disposition') contentDisposition = h.value || '';
    }

    const isMediaMime = MEDIA_MIME_PATTERNS.some(pat => pat.test(contentType));
    const isMediaExt = MEDIA_EXTENSIONS.test(details.url);
    const isAttachment = contentDisposition.includes('attachment');

    // Filter out UI sound effects and tiny chunks (< 150KB unless explicit streaming playlist like m3u8)
    const isStreamManifest = details.url.includes('.m3u8') || details.url.includes('.mpd');
    if (!isStreamManifest && contentLength > 0 && contentLength < 150000) {
      return;
    }

    if (isMediaMime || isMediaExt || isAttachment) {
      let mediaList = tabMediaMap.get(details.tabId) || [];

      // Avoid duplicates
      if (!mediaList.some(item => item.url === details.url)) {
        const titleMatch = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
        let filename = titleMatch ? decodeURIComponent(titleMatch[1].trim()) : '';
        if (!filename) {
          try {
            const parsed = new URL(details.url);
            filename = parsed.pathname.split('/').filter(Boolean).pop() || 'media_stream';
          } catch (e) {
            filename = 'media_stream';
          }
        }

        const mediaItem = {
          url: details.url,
          filename: filename,
          contentType: contentType,
          size: contentLength,
          tabId: details.tabId,
          timestamp: Date.now()
        };

        mediaList.push(mediaItem);
        tabMediaMap.set(details.tabId, mediaList);

        // Update badge count
        chrome.action.setBadgeText({ tabId: details.tabId, text: `${mediaList.length}` });
        chrome.action.setBadgeBackgroundColor({ tabId: details.tabId, color: '#10b981' });

        // Notify content script
        chrome.tabs.sendMessage(details.tabId, { action: 'MEDIA_DETECTED', media: mediaItem }).catch(() => {});
      }
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Clear tab records when closed or refreshed
chrome.tabs.onRemoved.addListener((tabId) => tabMediaMap.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabMediaMap.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: '' });
  }
});

// Message listener from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'GET_TAB_MEDIA') {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    const list = tabMediaMap.get(tabId) || [];
    sendResponse({ media: list });
    return true;
  }

  if (message.action === 'DOWNLOAD_WITH_PANDA') {
    forwardDownloadToPanda(message.payload)
      .then(res => sendResponse({ success: true, res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }
});

// Dual-channel communication: Try Native Messaging Host first, then Local Loopback HTTP API
async function forwardDownloadToPanda(payload) {
  // Method 1: Local HTTP loopback API (fastest and zero-config)
  try {
    const response = await fetch('http://127.0.0.1:45731/api/intercept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (err) {
    // Fallback to Native Messaging Host
  }

  // Method 2: Chrome Native Messaging Host
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(
      'com.panda.downloader',
      payload,
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error('Panda Downloader is not running. Please start the Panda Downloader desktop application.'));
        }
        resolve(response);
      }
    );
  });
}
