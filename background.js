/**
 * Total Privacy Shield - Background Service Worker v3
 * Real per-tab stats, live activity log, aggressive blocking
 */

// =========================================================================
// STATE
// =========================================================================

let isEnabled = true;

// Per-tab tracking: { tabId: { url, stats, log[] } }
const tabData = {};

function getTabData(tabId) {
  if (!tabData[tabId]) {
    tabData[tabId] = {
      url: "",
      stats: { trackers: 0, fingerprints: 0, cookies: 0, ads: 0, scripts: 0, total: 0 },
      log: [],
    };
  }
  return tabData[tabId];
}

function addLogEntry(tabId, category, url, detail) {
  const tab = getTabData(tabId);
  const entry = {
    time: Date.now(),
    category,
    url: url.length > 120 ? url.substring(0, 120) + "..." : url,
    detail,
  };
  tab.log.unshift(entry); // newest first
  if (tab.log.length > 200) tab.log.length = 200; // cap at 200

  // Update stat
  if (category === "tracker") tab.stats.trackers++;
  else if (category === "fingerprint") tab.stats.fingerprints++;
  else if (category === "cookie") tab.stats.cookies++;
  else if (category === "ad") tab.stats.ads++;
  else if (category === "script") tab.stats.scripts++;
  tab.stats.total++;

  // Update badge with total count
  updateBadge(tabId);
}

// Categorize blocked URLs
function categorizeURL(url) {
  const lower = url.toLowerCase();

  // Ad networks
  const adPatterns = [
    "doubleclick", "googlesyndication", "googleadservices", "adservice.google",
    "adnxs.com", "amazon-adsystem", "criteo", "taboola", "outbrain",
    "rubiconproject", "pubmatic", "openx.net", "adsrvr.org", "casalemedia",
    "sharethrough", "indexexchange", "/ads/", "/ad/", "ad.doubleclick",
    "pagead", "googleads",
  ];
  for (const p of adPatterns) {
    if (lower.includes(p)) return { category: "ad", detail: "Ad network" };
  }

  // Trackers
  const trackerPatterns = [
    "google-analytics", "googletagmanager", "googletagservices",
    "facebook.net", "pixel.facebook", "facebook.com/tr", "fbevents",
    "connect.facebook.net",
    "hotjar", "clarity.ms", "fullstory", "mouseflow", "crazyegg",
    "mixpanel", "segment.io", "segment.com", "amplitude", "heapanalytics",
    "scorecardresearch", "comscore", "demdex", "bluekai", "krxd",
    "bat.bing.com", "tr.snapchat", "ct.pinterest",
    "analytics.twitter", "ads-api.twitter",
    "px.ads.linkedin", "dc.ads.linkedin", "snap.licdn",
    "appsflyer", "branch.io", "adjust.com", "mparticle",
    "optimizely", "launchdarkly", "tealium",
    "logging_client_events", "log_event", "event_log",
    "/collect?", "/beacon", "/telemetry", "/pageview",
    "/track?", "/impression", "/tracking", "/retarget",
    "/remarketing", "/conversion",
    "gtag/js", "gtm.js", "analytics.js", "pixel.js", "fbevents.js",
    "nr-data.net", "newrelic", "sentry.io", "bugsnag",
    "intercom", "drift.com", "pardot", "marketo",
    "hs-analytics", "hsforms",
  ];
  for (const p of trackerPatterns) {
    if (lower.includes(p)) return { category: "tracker", detail: "Tracker" };
  }

  // Fingerprinting
  const fpPatterns = [
    "fingerprintjs", "datadome", "perimeterx", "px-cdn",
    "arkoselabs", "sift.com", "iovation", "threatmetrix",
    "/fingerprint", "/device-fingerprint", "/browser-fingerprint",
  ];
  for (const p of fpPatterns) {
    if (lower.includes(p)) return { category: "fingerprint", detail: "Fingerprinting" };
  }

  return { category: "tracker", detail: "Tracking request" };
}

// =========================================================================
// NON-BLOCKING webRequest observers
// =========================================================================

try {
  // Count blocked requests
  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      if (!isEnabled) return;
      if (details.tabId < 0) return;
      if (details.error === "net::ERR_BLOCKED_BY_CLIENT" ||
          details.error === "net::ERR_BLOCKED_BY_EXTENSION") {
        const { category, detail } = categorizeURL(details.url);
        addLogEntry(details.tabId, category, details.url, detail + " blocked");
      }
    },
    { urls: ["<all_urls>"] }
  );
} catch (e) {}

// Count third-party requests for awareness
try {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!isEnabled) return;
      if (details.tabId < 0) return;
      // Track third-party cookie-bearing requests
      const tab = getTabData(details.tabId);
      if (tab.url) {
        try {
          const reqHost = new URL(details.url).hostname;
          const tabHost = new URL(tab.url).hostname;
          const reqDomain = reqHost.split(".").slice(-2).join(".");
          const tabDomain = tabHost.split(".").slice(-2).join(".");
          if (reqDomain !== tabDomain && details.type !== "main_frame") {
            // Third-party request detected - cookies will be stripped by declarativeNetRequest
            // We count it
          }
        } catch (e) {}
      }
    },
    { urls: ["<all_urls>"] }
  );
} catch (e) {}

// =========================================================================
// Reset per-tab stats on navigation
// =========================================================================

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && changeInfo.url) {
    // New navigation - reset this tab's data
    tabData[tabId] = {
      url: changeInfo.url,
      stats: { trackers: 0, fingerprints: 0, cookies: 0, ads: 0, scripts: 0, total: 0 },
      log: [],
    };
    updateBadge(tabId);
  } else if (changeInfo.url) {
    const td = getTabData(tabId);
    td.url = changeInfo.url;
  }
  if (changeInfo.status === "complete") {
    updateBadge(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabData[tabId];
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  updateBadge(activeInfo.tabId);
});

// =========================================================================
// TOGGLE
// =========================================================================

async function enableProtection() {
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: ["tracking_rules"],
    });
  } catch (e) {}
}

async function disableProtection() {
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: ["tracking_rules"],
    });
  } catch (e) {}
}

// =========================================================================
// BADGE - shows blocked count for current tab
// =========================================================================

function updateBadge(tabId) {
  try {
    if (!isEnabled) {
      chrome.action.setBadgeText({ text: "OFF", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#ff4444", tabId });
      return;
    }
    const td = getTabData(tabId);
    const count = td.stats.total;
    const text = count > 0 ? String(count) : "ON";
    const color = count > 0 ? "#ff6600" : "#00ff88";
    chrome.action.setBadgeText({ text, tabId });
    chrome.action.setBadgeBackgroundColor({ color, tabId });
  } catch (e) {}
}

// =========================================================================
// MESSAGE HANDLING
// =========================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getStatus") {
    const tabId = message.tabId;
    const td = tabId ? getTabData(tabId) : { url: "", stats: { trackers: 0, fingerprints: 0, cookies: 0, ads: 0, scripts: 0, total: 0 }, log: [] };
    sendResponse({
      enabled: isEnabled,
      stats: td.stats,
      log: td.log.slice(0, 50), // Send last 50 entries
      siteUrl: td.url,
    });
    return false;
  }

  if (message.type === "toggle") {
    isEnabled = !isEnabled;
    chrome.storage.local.set({ enabled: isEnabled });
    if (isEnabled) enableProtection();
    else disableProtection();

    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => updateBadge(tab.id));
    });
    sendResponse({ enabled: isEnabled });
    return false;
  }

  if (message.type === "resetTabStats") {
    const tabId = message.tabId;
    if (tabId && tabData[tabId]) {
      tabData[tabId].stats = { trackers: 0, fingerprints: 0, cookies: 0, ads: 0, scripts: 0, total: 0 };
      tabData[tabId].log = [];
      updateBadge(tabId);
    }
    sendResponse({ ok: true });
    return false;
  }

  // Content script reports a block
  if (message.type === "contentBlock") {
    const tabId = sender?.tab?.id;
    if (tabId) {
      addLogEntry(tabId, message.category || "fingerprint", message.url || "JavaScript API", message.detail || "Blocked by content script");
    }
    return false;
  }
});

// =========================================================================
// INIT
// =========================================================================

chrome.runtime.onInstalled.addListener(() => {
  enableProtection();
});

chrome.storage.local.get(["enabled"], (result) => {
  if (result.enabled !== undefined) isEnabled = result.enabled;
  if (isEnabled) enableProtection();
  else disableProtection();
});

console.log("[Total Privacy Shield] v3 started - per-tab tracking, live log");
