/**
 * Total Privacy Shield - Background Service Worker (MV3 Compatible)
 * Uses ONLY declarativeNetRequest for blocking - NO webRequestBlocking.
 */

// =========================================================================
// STATE
// =========================================================================

let isEnabled = true;
let stats = {
  trackersBlocked: 0,
  fingerprintsBlocked: 0,
  cookiesBlocked: 0,
  totalBlocked: 0,
};

// =========================================================================
// TRACK MATCHED RULES FOR STATS (declarativeNetRequest event)
// =========================================================================

// This fires whenever a declarativeNetRequest rule matches
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  if (!isEnabled) return;

  const ruleId = info.rule.ruleId;

  if (ruleId >= 1 && ruleId <= 200) {
    stats.trackersBlocked++;
  } else if (ruleId >= 201 && ruleId <= 300) {
    stats.fingerprintsBlocked++;
  } else if (ruleId >= 301 && ruleId <= 400) {
    stats.cookiesBlocked++;
  }
  stats.totalBlocked++;

  // Save stats periodically
  chrome.storage.local.set({ stats });
});

// =========================================================================
// DYNAMIC RULES - Added at runtime for toggle support
// =========================================================================

async function enableProtection() {
  // The static rules from tracking_rules.json are always loaded.
  // We use updateEnabledRulesets to toggle them.
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: ["tracking_rules"],
    });
  } catch (e) {
    console.log("[TPS] Rules already enabled");
  }
  console.log("[Total Privacy Shield] Protection ENABLED");
}

async function disableProtection() {
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      disableRulesetIds: ["tracking_rules"],
    });
  } catch (e) {
    console.log("[TPS] Rules already disabled");
  }
  console.log("[Total Privacy Shield] Protection DISABLED");
}

// =========================================================================
// BADGE & STATE MANAGEMENT
// =========================================================================

function updateBadge(tabId) {
  const text = isEnabled ? "ON" : "OFF";
  const color = isEnabled ? "#00ff88" : "#ff4444";
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color, tabId });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    updateBadge(tabId);

    // Count blocked requests for this tab using getMatchedRules
    if (isEnabled) {
      chrome.declarativeNetRequest.getMatchedRules({ tabId }, (details) => {
        if (details && details.rulesMatchedInfo) {
          const count = details.rulesMatchedInfo.length;
          if (count > 0) {
            chrome.action.setBadgeText({ text: String(count), tabId });
          }
        }
      });
    }
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  updateBadge(activeInfo.tabId);
});

// =========================================================================
// MESSAGE HANDLING (Communication with popup)
// =========================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getStatus") {
    // Also get real-time matched rules count
    chrome.declarativeNetRequest.getMatchedRules({}, (details) => {
      let ruleCount = 0;
      if (details && details.rulesMatchedInfo) {
        ruleCount = details.rulesMatchedInfo.length;
        // Update stats from actual rule matches
        stats.totalBlocked = Math.max(stats.totalBlocked, ruleCount);
        if (stats.trackersBlocked === 0 && ruleCount > 0) {
          stats.trackersBlocked = ruleCount;
          stats.totalBlocked = ruleCount;
        }
      }
      sendResponse({ enabled: isEnabled, stats });
    });
    return true; // async response
  }

  if (message.type === "toggle") {
    isEnabled = !isEnabled;
    chrome.storage.local.set({ enabled: isEnabled });

    if (isEnabled) {
      enableProtection();
    } else {
      disableProtection();
    }

    // Update all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => updateBadge(tab.id));
    });

    sendResponse({ enabled: isEnabled, stats });
    return true;
  }

  if (message.type === "resetStats") {
    stats = {
      trackersBlocked: 0,
      fingerprintsBlocked: 0,
      cookiesBlocked: 0,
      totalBlocked: 0,
    };
    chrome.storage.local.set({ stats });
    sendResponse({ stats });
    return true;
  }
});

// =========================================================================
// INITIALIZATION
// =========================================================================

chrome.storage.local.get(["enabled", "stats"], (result) => {
  if (result.enabled !== undefined) {
    isEnabled = result.enabled;
  }
  if (result.stats) {
    stats = result.stats;
  }

  if (isEnabled) {
    enableProtection();
  } else {
    disableProtection();
  }

  // Set initial badge on all tabs
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => updateBadge(tab.id));
  });
});

console.log("[Total Privacy Shield] Background service worker started (MV3 - no webRequestBlocking)");
