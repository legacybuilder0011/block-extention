/**
 * Content Bridge - ISOLATED world
 * Relays block events and URL updates from MAIN world content script to background service worker.
 */

window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  if (event.data && event.data.type === "TPS_BLOCK") {
    try {
      chrome.runtime.sendMessage({
        type: "contentBlock",
        category: event.data.category || "fingerprint",
        url: event.data.url || "JavaScript API",
        detail: event.data.detail || "Blocked",
        protection: event.data.protection || null,
      });
    } catch (e) {}
  }

  // Relay SPA navigation URL updates to background
  if (event.data && event.data.type === "TPS_URL_UPDATE") {
    try {
      chrome.runtime.sendMessage({
        type: "urlUpdate",
        url: event.data.url,
      });
    } catch (e) {}
  }
});
