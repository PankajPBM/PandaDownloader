// Panda Downloader - YouTube Main World Bridge
// Runs in the webpage's MAIN context with full native access to YouTube's player and global objects.
(function() {
  if (window.__pandaYtBridgeInstalled) return;
  window.__pandaYtBridgeInstalled = true;

  function extractFormats() {
    try {
      const player = document.getElementById('movie_player');
      let playerResponse = null;

      if (player && typeof player.getPlayerResponse === 'function') {
        playerResponse = player.getPlayerResponse();
      }

      if (!playerResponse && window.ytInitialPlayerResponse) {
        playerResponse = window.ytInitialPlayerResponse;
      }

      if (!playerResponse || !playerResponse.streamingData) {
        return null;
      }

      const streamingData = playerResponse.streamingData;
      const videoDetails = playerResponse.videoDetails || {};
      const videoId = videoDetails.videoId || '';
      const title = videoDetails.title || document.title || '';
      const duration = parseInt(videoDetails.lengthSeconds || '0', 10);

      const adaptive = Array.isArray(streamingData.adaptiveFormats) ? streamingData.adaptiveFormats : [];
      const combined = Array.isArray(streamingData.formats) ? streamingData.formats : [];
      const allFormats = [...adaptive, ...combined];

      return {
        videoId,
        title,
        duration,
        streamingData,
        formats: allFormats
      };
    } catch (e) {
      return null;
    }
  }

  function broadcastData() {
    const data = extractFormats();
    if (data && data.formats && data.formats.length > 0) {
      window.postMessage({
        type: 'PANDA_YT_STREAMING_DATA',
        ...data
      }, '*');
    }
  }

  // Broadcast on standard YouTube SPA lifecycle events
  window.addEventListener('yt-navigate-finish', () => setTimeout(broadcastData, 200));
  window.addEventListener('yt-page-data-updated', () => setTimeout(broadcastData, 200));
  window.addEventListener('yt-player-updated', () => setTimeout(broadcastData, 100));

  // Respond immediately when content.js requests current player data
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'PANDA_REQUEST_YT_DATA') {
      broadcastData();
    }
  });

  // Initial probe
  broadcastData();
  setTimeout(broadcastData, 1000);
  setTimeout(broadcastData, 2500);
})();
