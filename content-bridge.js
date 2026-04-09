/**
 * Content Bridge - ISOLATED world
 * Relays block events and URL updates from MAIN world content script to background service worker.
 * Also syncs the paused sites list from chrome.storage to localStorage so the MAIN world script
 * can read it synchronously on next page load.
 */

// Sync paused sites list from chrome.storage to localStorage on every load.
// This ensures the MAIN world content script can read it synchronously.
try {
  chrome.storage.local.get(["pausedSites"], (result) => {
    const list = result.pausedSites || [];
    try {
      localStorage.setItem("TPS_PAUSED_SITES", JSON.stringify(list));
    } catch (e) {}
  });
} catch (e) {}

// Listen for storage changes so if user pauses from another tab, we update here too
try {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.pausedSites) {
      try {
        localStorage.setItem("TPS_PAUSED_SITES", JSON.stringify(changes.pausedSites.newValue || []));
      } catch (e) {}
    }
  });
} catch (e) {}

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
