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

// Broad list of downloadable extensions intercepted from browser (excluding raw video fragment chunks like .ts and .m4s)
const DOWNLOAD_EXTENSIONS = /\.(mp4|webm|mkv|flv|avi|mov|wmv|m4v|mp3|m4a|aac|wav|ogg|flac|opus|m3u8|mpd|zip|rar|7z|tar|gz|bz2|iso|xz|exe|msi|apk|dmg|pkg|deb|rpm|bin|img|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|rtf|torrent|cab|msix|appx)(\?.*)?$/i;
const WEB_PAGE_EXTENSIONS = /\.(html?|php|aspx?|jsp|css|js|json)(\?.*)?$/i;

// Global ON/OFF toggle state
let extensionEnabled = true;

// Load persisted ON/OFF state
chrome.storage.local.get(['extensionEnabled'], (res) => {
  if (res && typeof res.extensionEnabled === 'boolean') {
    extensionEnabled = res.extensionEnabled;
    syncBadgeState();
  }
});

// Sync badge state across all tabs
function syncBadgeState() {
  try {
    if (!extensionEnabled) {
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setBadgeBackgroundColor({ color: '#64748b' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {}
}

// React to storage changes from popup or options
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.extensionEnabled) {
    extensionEnabled = changes.extensionEnabled.newValue;
    syncBadgeState();
  }
});

// Health check to ensure Panda Downloader desktop daemon is running
let isPandaRunning = true;
async function checkPandaHealth() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch('http://127.0.0.1:45731/api/status', { method: 'GET', signal: ctrl.signal });
    clearTimeout(timer);
    isPandaRunning = res.ok;
  } catch (e) {
    isPandaRunning = false;
  }
}
setInterval(checkPandaHealth, 4000);
checkPandaHealth();

// Registry of already intercepted download IDs to prevent duplicate triggers
const interceptedIds = new Set();

function shouldInterceptDownload(downloadItem) {
  if (!extensionEnabled || !isPandaRunning || !downloadItem || !downloadItem.url) return false;

  const url = downloadItem.finalUrl || downloadItem.url;
  if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('chrome:') || url.startsWith('chrome-extension:')) {
    return false;
  }

  const filename = downloadItem.filename ? downloadItem.filename.split(/[\/\\]/).pop() : '';

  // Exclude ordinary web page visits
  if (WEB_PAGE_EXTENSIONS.test(filename || url) && (!downloadItem.mime || downloadItem.mime === 'text/html')) {
    return false;
  }

  const isExtensionMatch = DOWNLOAD_EXTENSIONS.test(url) || (filename && DOWNLOAD_EXTENSIONS.test(filename));
  const isBinaryMime = downloadItem.mime && (
    downloadItem.mime === 'application/octet-stream' ||
    downloadItem.mime.startsWith('video/') ||
    downloadItem.mime.startsWith('audio/') ||
    downloadItem.mime.includes('zip') ||
    downloadItem.mime.includes('compressed') ||
    downloadItem.mime.includes('pdf') ||
    downloadItem.mime.includes('binary')
  );
  const hasGenericFileExtension = filename && filename.includes('.') && !WEB_PAGE_EXTENSIONS.test(filename);

  return (isExtensionMatch || isBinaryMime || hasGenericFileExtension);
}

// Cancel browser download immediately and transfer to Panda Downloader
async function processInterception(downloadItem) {
  if (interceptedIds.has(downloadItem.id)) return;
  interceptedIds.add(downloadItem.id);

  if (interceptedIds.size > 500) {
    const first = interceptedIds.values().next().value;
    interceptedIds.delete(first);
  }

  // 1. Immediately cancel and erase browser download so Chrome NEVER shows "Save As"
  try {
    chrome.downloads.cancel(downloadItem.id, () => {
      if (chrome.runtime.lastError) {}
      chrome.downloads.erase({ id: downloadItem.id }, () => {
        if (chrome.runtime.lastError) {}
      });
    });
  } catch (e) {}

  // 2. Dispatch payload to Panda Downloader
  const filename = downloadItem.filename ? downloadItem.filename.split(/[\/\\]/).pop() : '';
  const payload = {
    url: downloadItem.finalUrl || downloadItem.url,
    filename: filename,
    referrer: downloadItem.referrer || '',
    fileSize: downloadItem.fileSize || 0,
    mime: downloadItem.mime || ''
  };

  try {
    await forwardDownloadToPanda(payload);
  } catch (err) {
    console.warn('[Panda Downloader] Desktop forward failed:', err);
  }
}

// Hook browser download events
if (chrome.downloads) {
  // onCreated fires immediately when browser registers download
  if (chrome.downloads.onCreated) {
    chrome.downloads.onCreated.addListener((downloadItem) => {
      if (shouldInterceptDownload(downloadItem)) {
        processInterception(downloadItem);
      }
    });
  }

  // onDeterminingFilename determines where file will be saved
  if (chrome.downloads.onDeterminingFilename) {
    chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
      if (interceptedIds.has(downloadItem.id)) {
        // Already intercepted! CRITICAL: Cancel again and DO NOT call suggest()
        try {
          chrome.downloads.cancel(downloadItem.id, () => {});
        } catch (e) {}
        return false;
      }

      if (shouldInterceptDownload(downloadItem)) {
        processInterception(downloadItem);
        return false;
      }

      // Normal browser download: let browser proceed
      if (suggest) suggest();
      return false;
    });
  }
}

// Context Menu: "Download with Panda Downloader"
try {
  chrome.runtime.onInstalled.addListener(() => {
    if (chrome.contextMenus) {
      chrome.contextMenus.create({
        id: 'panda-download-item',
        title: 'Download with Panda Downloader',
        contexts: ['link', 'image', 'video', 'audio']
      }, () => {
        if (chrome.runtime.lastError) {}
      });
    }
  });

  if (chrome.contextMenus && chrome.contextMenus.onClicked) {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      const targetUrl = info.linkUrl || info.srcUrl;
      if (targetUrl) {
        forwardDownloadToPanda({
          url: targetUrl,
          referrer: tab ? tab.url : ''
        }).catch(() => {});
      }
    });
  }
} catch (e) {}

// Sniff network responses for video, audio, and large download streams
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    try {
      if (!extensionEnabled || details.tabId < 0) return;

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
      const isMediaExt = DOWNLOAD_EXTENSIONS.test(details.url);
      const isAttachment = contentDisposition.includes('attachment');

      // IDM Best Practice: Filter out raw streaming fragment chunks (.ts, .m4s, etc.)
      const isFragmentChunk = /\.(ts|m4s|m4v-segment|dash|part)(\?.*)?$/i.test(details.url) || 
                              /\b(seg-\d+|fragment-\d+|chunk-\d+|range=\d+-\d+)\b/i.test(details.url);
      if (isFragmentChunk) {
        return;
      }

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

          // Update badge count safely when enabled
          if (extensionEnabled) {
            try {
              chrome.action.setBadgeText({ tabId: details.tabId, text: `${mediaList.length}` }, () => {
                if (chrome.runtime.lastError) {}
              });
              chrome.action.setBadgeBackgroundColor({ tabId: details.tabId, color: '#10b981' }, () => {
                if (chrome.runtime.lastError) {}
              });
            } catch (e) {}

            // Immediately notify floating video panel on this tab
            try {
              chrome.tabs.sendMessage(details.tabId, {
                action: 'MEDIA_DETECTED',
                media: mediaList
              }, () => {
                if (chrome.runtime.lastError) {}
              });
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      console.warn('[Panda Downloader] onHeadersReceived error:', err);
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Clear tab records when closed or refreshed, or when navigating to another video (SPA)
chrome.tabs.onRemoved.addListener((tabId) => tabMediaMap.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    tabMediaMap.delete(tabId);
    try {
      if (extensionEnabled) {
        chrome.action.setBadgeText({ tabId, text: '' }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
    } catch (e) {}
  }
});

// Message listener from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'SET_EXTENSION_ENABLED') {
    extensionEnabled = Boolean(message.enabled);
    chrome.storage.local.set({ extensionEnabled: extensionEnabled });
    syncBadgeState();

    // Broadcast to all open tabs so floating panel is immediately removed when turned OFF
    try {
      chrome.tabs.query({}, (tabs) => {
        for (const t of tabs) {
          if (t && t.id) {
            chrome.tabs.sendMessage(t.id, { action: 'TOGGLE_EXTENSION', enabled: extensionEnabled }).catch(() => {});
          }
        }
      });
    } catch (e) {}

    sendResponse({ success: true, enabled: extensionEnabled });
    return true;
  }

  if (message.action === 'GET_TAB_MEDIA') {
    let tabId = message.tabId || (sender.tab && sender.tab.id);
    let list = (tabId && tabMediaMap.get(tabId)) || [];
    if (list.length === 0) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          const fallbackList = tabMediaMap.get(tabs[0].id) || [];
          sendResponse({ media: fallbackList });
        } else {
          sendResponse({ media: [] });
        }
      });
      return true;
    }
    sendResponse({ media: list });
    return true;
  }

  if (message.action === 'PROBE_VIDEO_FORMATS') {
    const videoUrl = message.url;
    fetch(`http://127.0.0.1:45731/api/probe?url=${encodeURIComponent(videoUrl)}`)
      .then(r => r.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
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
