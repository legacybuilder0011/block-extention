/**
 * Total Privacy Shield - Background Service Worker v4
 * Per-tab stats with per-protection-category counts
 */

let isEnabled = true;
const tabData = {};

// Protection categories that map to the dashboard grid
const PROTECTION_KEYS = [
  "ip_location", "webrtc", "canvas", "webgl_gpu",
  "font", "screen", "browser_os", "wifi_network",
  "audio_fp", "cookies", "sensors", "ads_scripts"
];

function freshStats() {
  return {
    trackers: 0, fingerprints: 0, cookies: 0, ads: 0, total: 0,
    // Per-protection counters
    protections: {
      ip_location: 0, webrtc: 0, canvas: 0, webgl_gpu: 0,
      font: 0, screen: 0, browser_os: 0, wifi_network: 0,
      audio_fp: 0, cookies: 0, sensors: 0, ads_scripts: 0,
    },
  };
}

function getTabData(tabId) {
  if (!tabData[tabId]) {
    tabData[tabId] = { url: "", stats: freshStats(), log: [] };
  }
  return tabData[tabId];
}

function addLogEntry(tabId, category, url, detail, protection) {
  const tab = getTabData(tabId);
  tab.log.unshift({
    time: Date.now(),
    category,
    url: url && url.length > 120 ? url.substring(0, 120) + "..." : (url || ""),
    detail,
    protection,
  });
  if (tab.log.length > 200) tab.log.length = 200;

  if (category === "tracker") tab.stats.trackers++;
  else if (category === "fingerprint") tab.stats.fingerprints++;
  else if (category === "cookie") tab.stats.cookies++;
  else if (category === "ad") tab.stats.ads++;
  tab.stats.total++;

  // Update protection counter
  if (protection && tab.stats.protections[protection] !== undefined) {
    tab.stats.protections[protection]++;
  }

  updateBadge(tabId);
}

// Categorize blocked URLs from network level
function categorizeURL(url) {
  const lower = url.toLowerCase();
  const adPatterns = [
    "doubleclick", "googlesyndication", "googleadservices", "adservice.google",
    "adnxs.com", "amazon-adsystem", "criteo", "taboola", "outbrain",
    "rubiconproject", "pubmatic", "openx.net", "adsrvr.org", "casalemedia",
    "sharethrough", "indexexchange", "/ads/", "/ad/", "ad.doubleclick",
    "pagead", "googleads", "2mdn.net", "serving-sys", "moatads",
    "advertising.com", "bidswitch", "simpli.fi", "mediavine",
  ];
  for (const p of adPatterns) {
    if (lower.includes(p)) return { category: "ad", detail: "Ad network blocked", protection: "ads_scripts" };
  }

  const cookiePatterns = ["set-cookie", "cookie"];
  const trackerPatterns = [
    { patterns: ["google-analytics", "googletagmanager", "googletagservices", "gtag/js", "gtm.js", "analytics.js"], protection: "ads_scripts" },
    { patterns: ["facebook.net", "pixel.facebook", "facebook.com/tr", "fbevents", "connect.facebook.net"], protection: "ads_scripts" },
    { patterns: ["hotjar", "clarity.ms", "fullstory", "mouseflow", "crazyegg", "mixpanel", "amplitude", "heapanalytics", "segment.io", "segment.com"], protection: "ads_scripts" },
    { patterns: ["scorecardresearch", "comscore", "demdex", "bluekai", "krxd"], protection: "ads_scripts" },
    { patterns: ["bat.bing.com", "tr.snapchat", "ct.pinterest", "analytics.twitter", "ads-api.twitter", "px.ads.linkedin", "dc.ads.linkedin", "snap.licdn"], protection: "ads_scripts" },
    { patterns: ["logging_client_events", "log_event", "event_log", "/collect?", "/beacon", "/telemetry", "/pageview", "/track?", "/impression", "/tracking"], protection: "ads_scripts" },
    { patterns: ["nr-data.net", "newrelic", "sentry.io", "bugsnag", "intercom", "drift.com"], protection: "ads_scripts" },
  ];

  for (const group of trackerPatterns) {
    for (const p of group.patterns) {
      if (lower.includes(p)) return { category: "tracker", detail: "Tracker blocked", protection: group.protection };
    }
  }

  const fpPatterns = ["fingerprintjs", "datadome", "perimeterx", "px-cdn", "arkoselabs", "sift.com", "iovation", "threatmetrix", "/fingerprint"];
  for (const p of fpPatterns) {
    if (lower.includes(p)) return { category: "fingerprint", detail: "Fingerprinting blocked", protection: "browser_os" };
  }

  return { category: "tracker", detail: "Tracking request blocked", protection: "ads_scripts" };
}

// =========================================================================
// NON-BLOCKING webRequest observers
// =========================================================================

try {
  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      if (!isEnabled || details.tabId < 0) return;
      if (details.error === "net::ERR_BLOCKED_BY_CLIENT" ||
          details.error === "net::ERR_BLOCKED_BY_EXTENSION") {
        const { category, detail, protection } = categorizeURL(details.url);
        addLogEntry(details.tabId, category, details.url, detail, protection);
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
    tabData[tabId] = { url: changeInfo.url, stats: freshStats(), log: [] };
    updateBadge(tabId);
  } else if (changeInfo.url) {
    getTabData(tabId).url = changeInfo.url;
  }
  if (changeInfo.status === "complete") updateBadge(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => delete tabData[tabId]);
chrome.tabs.onActivated.addListener((a) => updateBadge(a.tabId));

// =========================================================================
// TOGGLE
// =========================================================================

async function enableProtection() {
  try { await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ["tracking_rules"] }); } catch (e) {}
}
async function disableProtection() {
  try { await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ["tracking_rules"] }); } catch (e) {}
}

// =========================================================================
// BADGE
// =========================================================================

function updateBadge(tabId) {
  try {
    if (!isEnabled) {
      chrome.action.setBadgeText({ text: "OFF", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#ff4444", tabId });
      return;
    }
    const count = getTabData(tabId).stats.total;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : "ON", tabId });
    chrome.action.setBadgeBackgroundColor({ color: count > 0 ? "#ff6600" : "#00ff88", tabId });
  } catch (e) {}
}

// =========================================================================
// MESSAGE HANDLING
// =========================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getStatus") {
    const td = message.tabId ? getTabData(message.tabId) : { url: "", stats: freshStats(), log: [] };
    sendResponse({
      enabled: isEnabled,
      stats: td.stats,
      log: td.log.slice(0, 50),
      siteUrl: td.url,
    });
    return false;
  }

  if (message.type === "toggle") {
    isEnabled = !isEnabled;
    chrome.storage.local.set({ enabled: isEnabled });
    if (isEnabled) enableProtection(); else disableProtection();
    chrome.tabs.query({}, (tabs) => tabs.forEach((tab) => updateBadge(tab.id)));
    sendResponse({ enabled: isEnabled });
    return false;
  }

  if (message.type === "resetTabStats") {
    const tabId = message.tabId;
    if (tabId && tabData[tabId]) {
      tabData[tabId].stats = freshStats();
      tabData[tabId].log = [];
      updateBadge(tabId);
    }
    sendResponse({ ok: true });
    return false;
  }

  // Content script reports a block with protection category
  if (message.type === "contentBlock") {
    const tabId = sender?.tab?.id;
    if (tabId) {
      addLogEntry(
        tabId,
        message.category || "fingerprint",
        message.url || "JavaScript API",
        message.detail || "Blocked",
        message.protection || null
      );
    }
    return false;
  }
});

// =========================================================================
// INIT
// =========================================================================

chrome.runtime.onInstalled.addListener(() => enableProtection());
chrome.storage.local.get(["enabled"], (result) => {
  if (result.enabled !== undefined) isEnabled = result.enabled;
  if (isEnabled) enableProtection(); else disableProtection();
});

console.log("[Total Privacy Shield] v4 - per-protection tracking");
