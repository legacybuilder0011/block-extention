/**
 * Content Bridge - ISOLATED world
 * Relays block events from MAIN world content script to background service worker.
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
});
