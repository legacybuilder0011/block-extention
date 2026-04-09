/**
 * Total Privacy Shield - Background Service Worker v5
 * Fixed: SPA navigation tracking, "No site loaded", continuous blocking
 */

let isEnabled = true;
const tabData = {};

function freshStats() {
  return {
    trackers: 0, fingerprints: 0, cookies: 0, ads: 0, total: 0,
    protections: {
      ip_location: 0, webrtc: 0, canvas: 0, webgl_gpu: 0,
      font: 0, screen: 0, browser_os: 0, wifi_network: 0,
      audio_fp: 0, cookies: 0, sensors: 0, ads_scripts: 0,
    },
  };
}

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
}

function getTabData(tabId) {
  if (!tabData[tabId]) {
    tabData[tabId] = { url: "", domain: "", stats: freshStats(), log: [] };
  }
  return tabData[tabId];
}

function addLogEntry(tabId, category, url, detail, protection) {
  const tab = getTabData(tabId);
  tab.log.unshift({
    time: Date.now(), category,
    url: url && url.length > 120 ? url.substring(0, 120) + "..." : (url || ""),
    detail, protection,
  });
  if (tab.log.length > 200) tab.log.length = 200;

  if (category === "tracker") tab.stats.trackers++;
  else if (category === "fingerprint") tab.stats.fingerprints++;
  else if (category === "cookie") tab.stats.cookies++;
  else if (category === "ad") tab.stats.ads++;
  tab.stats.total++;

  if (protection && tab.stats.protections[protection] !== undefined) {
    tab.stats.protections[protection]++;
  }
  updateBadge(tabId);
}

function categorizeURL(url) {
  const lower = url.toLowerCase();
  const adPatterns = [
    "doubleclick", "googlesyndication", "googleadservices", "adservice.google",
    "adnxs.com", "amazon-adsystem", "criteo", "taboola", "outbrain",
    "rubiconproject", "pubmatic", "openx.net", "adsrvr.org", "casalemedia",
    "sharethrough", "indexexchange", "/ads/", "/ad/", "ad.doubleclick",
    "pagead", "googleads", "2mdn.net", "serving-sys", "moatads",
    "advertising.com", "bidswitch", "simpli.fi",
  ];
  for (const p of adPatterns) {
    if (lower.includes(p)) return { category: "ad", detail: "Ad network blocked", protection: "ads_scripts" };
  }
  const trackerGroups = [
    { patterns: ["google-analytics", "googletagmanager", "googletagservices", "gtag/js", "gtm.js", "analytics.js"], protection: "ads_scripts" },
    { patterns: ["facebook.net", "pixel.facebook", "facebook.com/tr", "fbevents", "connect.facebook.net"], protection: "ads_scripts" },
    { patterns: ["hotjar", "clarity.ms", "fullstory", "mouseflow", "crazyegg", "mixpanel", "amplitude", "heapanalytics", "segment.io", "segment.com"], protection: "ads_scripts" },
    { patterns: ["scorecardresearch", "comscore", "demdex", "bluekai", "krxd"], protection: "ads_scripts" },
    { patterns: ["bat.bing.com", "tr.snapchat", "ct.pinterest", "analytics.twitter", "ads-api.twitter", "px.ads.linkedin", "dc.ads.linkedin", "snap.licdn"], protection: "ads_scripts" },
    { patterns: ["logging_client_events", "log_event", "event_log", "/collect?", "/beacon", "/telemetry", "/pageview", "/track?", "/impression", "/tracking"], protection: "ads_scripts" },
    { patterns: ["nr-data.net", "newrelic", "sentry.io", "bugsnag", "intercom", "drift.com"], protection: "ads_scripts" },
  ];
  for (const group of trackerGroups) {
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
// NON-BLOCKING webRequest observer
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
// TAB TRACKING - Fixed for SPA navigations
// Only reset stats when navigating to a DIFFERENT domain
// =========================================================================

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const td = getTabData(tabId);

  // Always keep the URL updated from the tab object
  if (tab && tab.url) {
    const newDomain = getDomain(tab.url);
    const oldDomain = td.domain;

    // Only reset stats if domain actually changed (e.g. instagram.com -> fiverr.com)
    // NOT when navigating within the same site (instagram.com/page1 -> instagram.com/page2)
    if (changeInfo.status === "loading" && newDomain && oldDomain && newDomain !== oldDomain) {
      tabData[tabId] = { url: tab.url, domain: newDomain, stats: freshStats(), log: [] };
    } else {
      // Same domain or first load - just update URL, keep stats
      td.url = tab.url;
      td.domain = newDomain;
    }
  }

  // Also capture URL from changeInfo as fallback
  if (changeInfo.url) {
    td.url = changeInfo.url;
    td.domain = getDomain(changeInfo.url);
  }

  updateBadge(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => delete tabData[tabId]);

chrome.tabs.onActivated.addListener((activeInfo) => {
  // Always sync URL when tab becomes active
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    const td = getTabData(activeInfo.tabId);
    if (tab.url) {
      td.url = tab.url;
      td.domain = getDomain(tab.url);
    }
    updateBadge(activeInfo.tabId);
  });
});

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
    const tabId = message.tabId;
    if (tabId) {
      const td = getTabData(tabId);
      // If we don't have a URL yet, try to get it from the tab
      if (!td.url && tabId) {
        chrome.tabs.get(tabId, (tab) => {
          if (!chrome.runtime.lastError && tab && tab.url) {
            td.url = tab.url;
            td.domain = getDomain(tab.url);
          }
          sendResponse({
            enabled: isEnabled,
            stats: td.stats,
            log: td.log.slice(0, 50),
            siteUrl: td.url,
          });
        });
        return true; // async
      }
      sendResponse({
        enabled: isEnabled,
        stats: td.stats,
        log: td.log.slice(0, 50),
        siteUrl: td.url,
      });
    } else {
      sendResponse({ enabled: isEnabled, stats: freshStats(), log: [], siteUrl: "" });
    }
    return false;
  }

  if (message.type === "toggle") {
    isEnabled = !isEnabled;
    chrome.storage.local.set({ enabled: isEnabled });
    if (isEnabled) enableProtection(); else disableProtection();
    chrome.tabs.query({}, (tabs) => tabs.forEach((t) => updateBadge(t.id)));
    sendResponse({ enabled: isEnabled });
    return false;
  }

  if (message.type === "resetTabStats") {
    const tabId = message.tabId;
    if (tabId && tabData[tabId]) {
      const url = tabData[tabId].url;
      const domain = tabData[tabId].domain;
      tabData[tabId] = { url, domain, stats: freshStats(), log: [] };
      updateBadge(tabId);
    }
    sendResponse({ ok: true });
    return false;
  }

  // Pause blocking on a specific site
  if (message.type === "pauseSite") {
    const domain = message.domain;
    const tabId = message.tabId;
    if (!domain) { sendResponse({ ok: false }); return false; }
    chrome.storage.local.get(["pausedSites"], (result) => {
      const list = result.pausedSites || [];
      if (!list.includes(domain)) list.push(domain);
      chrome.storage.local.set({ pausedSites: list }, () => {
        // Immediately write to the tab's localStorage so the next reload picks it up,
        // then reload the tab so the content script sees the paused state on document_start
        if (tabId) {
          try {
            chrome.scripting.executeScript({
              target: { tabId },
              func: (listStr) => {
                try { localStorage.setItem("TPS_PAUSED_SITES", listStr); } catch (e) {}
              },
              args: [JSON.stringify(list)],
            }).then(() => {
              chrome.tabs.reload(tabId);
            }).catch(() => { chrome.tabs.reload(tabId); });
          } catch (e) { try { chrome.tabs.reload(tabId); } catch (e2) {} }
        }
        sendResponse({ ok: true, pausedSites: list });
      });
    });
    return true; // async
  }

  // Resume blocking on a specific site
  if (message.type === "resumeSite") {
    const domain = message.domain;
    const tabId = message.tabId;
    if (!domain) { sendResponse({ ok: false }); return false; }
    chrome.storage.local.get(["pausedSites"], (result) => {
      const list = (result.pausedSites || []).filter((d) => d !== domain);
      chrome.storage.local.set({ pausedSites: list }, () => {
        if (tabId) {
          try {
            chrome.scripting.executeScript({
              target: { tabId },
              func: (listStr) => {
                try { localStorage.setItem("TPS_PAUSED_SITES", listStr); } catch (e) {}
              },
              args: [JSON.stringify(list)],
            }).then(() => {
              chrome.tabs.reload(tabId);
            }).catch(() => { chrome.tabs.reload(tabId); });
          } catch (e) { try { chrome.tabs.reload(tabId); } catch (e2) {} }
        }
        sendResponse({ ok: true, pausedSites: list });
      });
    });
    return true; // async
  }

  // Get paused sites list
  if (message.type === "getPausedSites") {
    chrome.storage.local.get(["pausedSites"], (result) => {
      sendResponse({ pausedSites: result.pausedSites || [] });
    });
    return true; // async
  }

  // Popup tells us the tab URL directly (most reliable)
  if (message.type === "setTabUrl") {
    const tabId = message.tabId;
    if (tabId && message.url) {
      const td = getTabData(tabId);
      td.url = message.url;
      td.domain = getDomain(message.url);
    }
    return false;
  }

  // Content script reports a block
  if (message.type === "contentBlock") {
    const tabId = sender?.tab?.id;
    if (tabId) {
      // Always update URL from sender tab info
      const td = getTabData(tabId);
      if (sender.tab.url) {
        td.url = sender.tab.url;
        td.domain = getDomain(sender.tab.url);
      }
      addLogEntry(tabId, message.category || "fingerprint", message.url || "JavaScript API", message.detail || "Blocked", message.protection || null);
    }
    return false;
  }

  // Content script reports current URL (for SPA navigation updates)
  if (message.type === "urlUpdate") {
    const tabId = sender?.tab?.id;
    if (tabId && message.url) {
      const td = getTabData(tabId);
      td.url = message.url;
      td.domain = getDomain(message.url);
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

console.log("[Total Privacy Shield] v5 - continuous SPA tracking");
