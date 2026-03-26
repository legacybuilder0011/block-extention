/**
 * Content Bridge - Runs in ISOLATED world (can communicate with background)
 * Listens for block events from the MAIN world content script via window messages,
 * then forwards them to the background service worker.
 */

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data && event.data.type === "TPS_BLOCK") {
    try {
      chrome.runtime.sendMessage({
        type: "contentBlock",
        category: event.data.category || "fingerprintsBlocked",
      });
    } catch (e) {
      // Extension context may be invalidated
    }
  }
});
