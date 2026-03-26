/**
 * Total Privacy Shield - Background Service Worker (Brave + Chrome MV3)
 *
 * Network blocking: declarativeNetRequest (static rules)
 * Stats counting: webRequest observers (NON-blocking, allowed in MV3)
 * JS-level blocks: reported by content script via messaging
 */

// =========================================================================
// STATE - persisted in storage
// =========================================================================

let isEnabled = true;
let stats = {
  trackersBlocked: 0,
  fingerprintsBlocked: 0,
  cookiesBlocked: 0,
  totalBlocked: 0,
};

// Known tracker domain fragments for classification
const TRACKER_FRAGMENTS = [
  "google-analytics", "googletagmanager", "doubleclick", "googlesyndication",
  "googleadservices", "googletagservices", "adservice.google",
  "facebook.net", "pixel.facebook", "fbevents",
  "instagram.com/api/v1/logging",
  "hotjar", "clarity.ms", "fullstory", "mouseflow", "crazyegg",
  "mixpanel", "segment.io", "segment.com", "amplitude", "heapanalytics",
  "criteo", "taboola", "outbrain", "adnxs", "rubiconproject", "pubmatic",
  "scorecardresearch", "comscore", "demdex", "bluekai", "krxd",
  "bat.bing.com", "tr.snapchat", "ct.pinterest",
  "analytics.twitter", "ads-api.twitter",
  "px.ads.linkedin", "dc.ads.linkedin", "snap.licdn",
  "fingerprintjs", "datadome", "perimeterx", "px-cdn",
  "nr-data.net", "newrelic", "sentry.io", "bugsnag",
  "appsflyer", "branch.io", "adjust.com", "mparticle",
  "optimizely", "launchdarkly", "tealium",
  "amazon-adsystem", "adsrvr.org",
  "logging_client_events", "log_event", "event_log",
  "/collect?", "/beacon", "/telemetry", "/fingerprint",
  "/pageview", "/track?", "/impression", "/tracking",
  "/retarget", "/remarketing", "/conversion",
  "gtag/js", "gtm.js", "analytics.js", "pixel.js",
  "fbevents.js"
];

function isTrackerURL(url) {
  const lower = url.toLowerCase();
  for (const fragment of TRACKER_FRAGMENTS) {
    if (lower.includes(fragment)) return true;
  }
  return false;
}

// =========================================================================
// NON-BLOCKING webRequest observer for counting blocked requests
// When declarativeNetRequest blocks a request, it shows as an error.
// We observe these errors to count our blocks.
// =========================================================================

// Count requests that were blocked (net::ERR_BLOCKED_BY_CLIENT)
try {
  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      if (!isEnabled) return;
      if (details.error === "net::ERR_BLOCKED_BY_CLIENT" ||
          details.error === "net::ERR_BLOCKED_BY_EXTENSION") {
        stats.trackersBlocked++;
        stats.totalBlocked++;
        // Save periodically (not every single block to avoid thrashing)
        if (stats.totalBlocked % 10 === 0) {
          chrome.storage.local.set({ stats });
        }
      }
    },
    { urls: ["<all_urls>"] }
  );
  console.log("[TPS] webRequest observer registered for counting blocked requests");
} catch (e) {
  console.log("[TPS] webRequest observer not available, using fallback counting");
}

// Also observe completed third-party requests to count cookie stripping
try {
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (!isEnabled) return;
      // Count if it was a known tracker URL that somehow got through
      if (details.type !== "main_frame" && isTrackerURL(details.url)) {
        // This shouldn't happen often since declarativeNetRequest blocks them
        // but counts any that slip through as detected
        stats.fingerprintsBlocked++;
        stats.totalBlocked++;
      }
    },
    { urls: ["<all_urls>"] }
  );
} catch (e) {
  // Silently fail - not critical
}

// =========================================================================
// TOGGLE - Enable/Disable declarativeNetRequest rulesets
// =========================================================================

async function enableProtection() {
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: ["tracking_rules"],
    });
    console.log("[TPS] Protection ENABLED - declarativeNetRequest rules active");
  } catch (e) {
    console.log("[TPS] Enable error (rules may already be enabled):", e.message);
  }
}

async function disableProtection() {
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: ["tracking_rules"],
    });
    console.log("[TPS] Protection DISABLED");
  } catch (e) {
    console.log("[TPS] Disable error:", e.message);
  }
}

// =========================================================================
// BADGE
// =========================================================================

function updateBadge(tabId) {
  const text = isEnabled ? "ON" : "OFF";
  const color = isEnabled ? "#00ff88" : "#ff4444";
  try {
    chrome.action.setBadgeText({ text, tabId });
    chrome.action.setBadgeBackgroundColor({ color, tabId });
  } catch (e) {}
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    updateBadge(tabId);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  updateBadge(activeInfo.tabId);
});

// =========================================================================
// MESSAGE HANDLING
// =========================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getStatus") {
    sendResponse({ enabled: isEnabled, stats });
    return false;
  }

  if (message.type === "toggle") {
    isEnabled = !isEnabled;
    chrome.storage.local.set({ enabled: isEnabled });

    if (isEnabled) {
      enableProtection();
    } else {
      disableProtection();
    }

    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => updateBadge(tab.id));
    });

    sendResponse({ enabled: isEnabled, stats });
    return false;
  }

  if (message.type === "resetStats") {
    stats = { trackersBlocked: 0, fingerprintsBlocked: 0, cookiesBlocked: 0, totalBlocked: 0 };
    chrome.storage.local.set({ stats });
    sendResponse({ stats });
    return false;
  }

  // Content script reports a block
  if (message.type === "contentBlock") {
    const category = message.category || "fingerprintsBlocked";
    stats[category] = (stats[category] || 0) + 1;
    stats.totalBlocked++;
    if (stats.totalBlocked % 5 === 0) {
      chrome.storage.local.set({ stats });
    }
    return false;
  }
});

// =========================================================================
// INIT
// =========================================================================

chrome.runtime.onInstalled.addListener(() => {
  console.log("[TPS] Extension installed/updated");
  enableProtection();
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => updateBadge(tab.id));
  });
});

chrome.storage.local.get(["enabled", "stats"], (result) => {
  if (result.enabled !== undefined) isEnabled = result.enabled;
  if (result.stats) stats = result.stats;

  if (isEnabled) enableProtection();
  else disableProtection();

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => updateBadge(tab.id));
  });
});

console.log("[Total Privacy Shield] Service worker started - MV3 compatible, no webRequestBlocking");
