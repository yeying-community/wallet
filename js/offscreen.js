const KEEP_ALIVE_INTERVAL_MS = 25000;

function pingBackground() {
  try {
    chrome.runtime.sendMessage({
      type: 'KEEP_ALIVE',
      timestamp: Date.now()
    });
  } catch (error) {
    // Ignore transient errors when the extension is reloading.
  }
}

pingBackground();
setInterval(pingBackground, KEEP_ALIVE_INTERVAL_MS);
