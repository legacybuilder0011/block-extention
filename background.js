/**
 * Total Privacy Shield - Background Service Worker
 * Handles network-level blocking of trackers, cookies, and fingerprinting requests.
 */

// =========================================================================
// STATE
// =========================================================================

let isEnabled = true;
let stats = {
  trackersBlocked: 0,
  fingerprintsBlocked: 0,
  cookiesBlocked: 0,
  webrtcBlocked: 0,
  totalBlocked: 0,
};

// =========================================================================
// KNOWN TRACKER DOMAINS (major tracking networks)
// =========================================================================

const TRACKER_DOMAINS = [
  // Google tracking
  "google-analytics.com",
  "googletagmanager.com",
  "googleadservices.com",
  "googlesyndication.com",
  "doubleclick.net",
  "googletagservices.com",
  "google.com/ads",
  "googleads.g.doubleclick.net",
  "pagead2.googlesyndication.com",
  "adservice.google.com",
  // Facebook/Meta tracking
  "facebook.net",
  "facebook.com/tr",
  "connect.facebook.net",
  "pixel.facebook.com",
  "graph.facebook.com/v*/",
  "www.facebook.com/ajax/bz",
  // Instagram tracking endpoints
  "i.instagram.com/api/v1/logging",
  // Analytics & tracking services
  "analytics.google.com",
  "hotjar.com",
  "fullstory.com",
  "mouseflow.com",
  "crazyegg.com",
  "luckyorange.com",
  "clarity.ms",
  "mixpanel.com",
  "segment.io",
  "segment.com",
  "amplitude.com",
  "heap.io",
  "heapanalytics.com",
  // Ad networks
  "criteo.com",
  "criteo.net",
  "outbrain.com",
  "taboola.com",
  "amazon-adsystem.com",
  "adsrvr.org",
  "adnxs.com",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "casalemedia.com",
  "sharethrough.com",
  "indexexchange.com",
  // Social tracking
  "platform.twitter.com/widgets",
  "syndication.twitter.com",
  "ads-api.twitter.com",
  "analytics.twitter.com",
  "t.co",
  "linkedin.com/px",
  "snap.licdn.com",
  "dc.ads.linkedin.com",
  "px.ads.linkedin.com",
  // Data brokers & fingerprinting
  "fingerprintjs.com",
  "fpjs.io",
  "fingerprint.com",
  "datadome.co",
  "perimeterx.net",
  "px-cdn.net",
  "arkoselabs.com",
  "sift.com",
  "iovation.com",
  "threatmetrix.com",
  // General trackers
  "scorecardresearch.com",
  "quantserve.com",
  "quantcount.com",
  "comscore.com",
  "bluekai.com",
  "krxd.net",
  "exelator.com",
  "agkn.com",
  "rlcdn.com",
  "demdex.net",
  "omtrdc.net",
  "2o7.net",
  "everesttech.net",
  "nr-data.net",
  "newrelic.com",
  "sentry.io",
  "bugsnag.com",
  // Fiverr-specific tracking
  "bat.bing.com",
  "tr.snapchat.com",
  "ct.pinterest.com",
];

// =========================================================================
// TRACKING URL PATTERNS
// =========================================================================

const TRACKING_PATTERNS = [
  /\/collect\?.*tid=/i, // Google Analytics collect
  /\/analytics\.js/i,
  /\/gtag\/js/i,
  /\/gtm\.js/i,
  /\/fbevents\.js/i,
  /\/pixel\.js/i,
  /\/beacon\/?/i,
  /\/track\/?(\?|$)/i,
  /\/telemetry/i,
  /\/fingerprint/i,
  /\/browser-fingerprint/i,
  /\/device-fingerprint/i,
  /\/collect-data/i,
  /\/log_event/i,
  /\/event_log/i,
  /\/capture/i,
  /\/pageview/i,
  /\/impression/i,
  /\/click\?/i,
  /\/conversion/i,
  /\/retarget/i,
  /\/remarketing/i,
  /\/audiencemanager/i,
  /\/tracking/i,
  /utm_source=/i,
  /fbclid=/i,
  /gclid=/i,
  /_ga=/i,
  /mc_eid=/i,
  /wickedid=/i,
];

// =========================================================================
// REQUEST BLOCKING
// =========================================================================

function isTrackerRequest(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Check tracker domains
    for (const domain of TRACKER_DOMAINS) {
      if (hostname.includes(domain) || hostname.endsWith("." + domain)) {
        return "tracker";
      }
    }

    // Check tracking URL patterns
    for (const pattern of TRACKING_PATTERNS) {
      if (pattern.test(url)) {
        return "tracking_pattern";
      }
    }

    return false;
  } catch (e) {
    return false;
  }
}

// =========================================================================
// HEADER MODIFICATION (Remove tracking headers, spoof UA)
// =========================================================================

const SPOOFED_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!isEnabled) return;

    const headers = details.requestHeaders.filter((header) => {
      const name = header.name.toLowerCase();
      // Remove tracking-related headers
      return ![
        "referer",           // Blocks referrer tracking
        "x-client-data",     // Chrome tracking header
        "x-requested-with",  // Can reveal app context
        "sec-ch-ua",         // Client hints
        "sec-ch-ua-mobile",
        "sec-ch-ua-platform",
        "sec-ch-ua-platform-version",
        "sec-ch-ua-arch",
        "sec-ch-ua-bitness",
        "sec-ch-ua-model",
        "sec-ch-ua-full-version",
        "sec-ch-ua-full-version-list",
      ].includes(name);
    });

    // Spoof User-Agent
    const uaHeader = headers.find(
      (h) => h.name.toLowerCase() === "user-agent"
    );
    if (uaHeader) {
      uaHeader.value = SPOOFED_UA;
    }

    // Remove tracking cookies from requests to third-party domains
    const cookieHeader = headers.find(
      (h) => h.name.toLowerCase() === "cookie"
    );
    if (cookieHeader && details.type !== "main_frame") {
      const initiator = details.initiator || "";
      try {
        const reqHost = new URL(details.url).hostname;
        const initHost = initiator ? new URL(initiator).hostname : "";
        if (reqHost !== initHost && initHost !== "") {
          // Third-party request - strip cookies
          const idx = headers.indexOf(cookieHeader);
          headers.splice(idx, 1);
          stats.cookiesBlocked++;
          stats.totalBlocked++;
        }
      } catch (e) {}
    }

    return { requestHeaders: headers };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestHeaders"]
);

// Block tracking response headers
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!isEnabled) return;

    const headers = details.responseHeaders.filter((header) => {
      const name = header.name.toLowerCase();
      // Remove tracking response headers
      if (name === "set-cookie") {
        // Block third-party cookies
        if (details.type !== "main_frame") {
          stats.cookiesBlocked++;
          stats.totalBlocked++;
          return false;
        }
        // Add SameSite=Strict to first-party cookies
        header.value += "; SameSite=Strict; Secure";
      }
      // Remove server timing (can leak info)
      if (name === "server-timing") return false;
      // Remove ETag (supercookie tracking)
      if (name === "etag") return false;
      return true;
    });

    // Add privacy headers
    headers.push(
      { name: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=(), bluetooth=(), usb=(), serial=(), hid=(), ambient-light-sensor=(), accelerometer=(), gyroscope=(), magnetometer=()" },
      { name: "X-Content-Type-Options", value: "nosniff" }
    );

    return { responseHeaders: headers };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "responseHeaders"]
);

// Block known tracker requests entirely
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isEnabled) return;

    const trackerType = isTrackerRequest(details.url);
    if (trackerType) {
      if (trackerType === "tracker") stats.trackersBlocked++;
      else stats.fingerprintsBlocked++;
      stats.totalBlocked++;
      return { cancel: true };
    }
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

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
    sendResponse({ enabled: isEnabled, stats });
    return true;
  }

  if (message.type === "toggle") {
    isEnabled = !isEnabled;
    chrome.storage.local.set({ enabled: isEnabled });

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
      webrtcBlocked: 0,
      totalBlocked: 0,
    };
    sendResponse({ stats });
    return true;
  }
});

// =========================================================================
// INITIALIZATION
// =========================================================================

chrome.storage.local.get(["enabled"], (result) => {
  if (result.enabled !== undefined) {
    isEnabled = result.enabled;
  }
  // Set initial badge
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => updateBadge(tab.id));
  });
});

console.log("[Total Privacy Shield] Background service worker started");
