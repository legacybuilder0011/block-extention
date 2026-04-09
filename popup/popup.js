/**
 * Total Privacy Shield - Popup v5.1
 * Per-tab stats with per-protection counts, reliable URL display
 */

document.addEventListener("DOMContentLoaded", () => {
  const toggleSwitch = document.getElementById("toggleSwitch");
  const siteUrlEl = document.getElementById("siteUrl");
  const activityLog = document.getElementById("activityLog");
  const protectionItems = document.querySelectorAll(".protection-item");
  let currentTabId = null;
  let currentTabUrl = null;

  // Tab navigation
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    });
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      currentTabId = tabs[0].id;
      // Get URL directly from the tab query - most reliable method
      currentTabUrl = tabs[0].url || tabs[0].pendingUrl || "";
      // Display immediately so it never says "No site loaded" if we have a URL
      if (currentTabUrl) {
        try {
          siteUrlEl.textContent = new URL(currentTabUrl).hostname;
          siteUrlEl.title = currentTabUrl;
        } catch (e) { siteUrlEl.textContent = currentTabUrl; }
      }
      // Tell background about this URL so it stores it
      if (currentTabUrl) {
        chrome.runtime.sendMessage({ type: "setTabUrl", tabId: currentTabId, url: currentTabUrl });
      }
      refreshStatus();
    }
  });

  toggleSwitch.addEventListener("change", () => {
    chrome.runtime.sendMessage({ type: "toggle" }, (response) => {
      if (response) {
        toggleSwitch.checked = response.enabled;
        updateProtectionStatus(response.enabled);
      }
    });
  });

  document.getElementById("resetStats").addEventListener("click", () => {
    if (currentTabId) {
      chrome.runtime.sendMessage({ type: "resetTabStats", tabId: currentTabId }, () => refreshStatus());
    }
  });

  document.getElementById("clearLog").addEventListener("click", () => {
    if (currentTabId) {
      chrome.runtime.sendMessage({ type: "resetTabStats", tabId: currentTabId }, () => {
        activityLog.innerHTML = '<div class="log-empty">Log cleared</div>';
      });
    }
  });

  // Pause/resume on current site
  const pauseBtn = document.getElementById("pauseSiteBtn");
  const pauseHint = document.getElementById("pauseHint");
  let pausedSites = [];

  function getCurrentDomain() {
    if (!currentTabUrl) return "";
    try {
      return new URL(currentTabUrl).hostname.replace(/^www\./, "");
    } catch (e) { return ""; }
  }

  function isCurrentSitePaused() {
    const host = getCurrentDomain();
    if (!host) return false;
    return pausedSites.some((d) => host === d || host.endsWith("." + d));
  }

  function updatePauseButton() {
    const paused = isCurrentSitePaused();
    if (paused) {
      pauseBtn.textContent = "Resume on this site";
      pauseBtn.classList.add("paused");
      pauseHint.textContent = "Blocking is OFF here";
    } else {
      pauseBtn.textContent = "Pause on this site";
      pauseBtn.classList.remove("paused");
      pauseHint.textContent = "Use when signup/login is blocked";
    }
  }

  function refreshPausedList() {
    chrome.runtime.sendMessage({ type: "getPausedSites" }, (response) => {
      if (response && response.pausedSites) {
        pausedSites = response.pausedSites;
        updatePauseButton();
      }
    });
  }

  pauseBtn.addEventListener("click", () => {
    const domain = getCurrentDomain();
    if (!domain || !currentTabId) return;
    const paused = isCurrentSitePaused();
    const msgType = paused ? "resumeSite" : "pauseSite";
    chrome.runtime.sendMessage({ type: msgType, domain, tabId: currentTabId }, (response) => {
      if (response && response.pausedSites) {
        pausedSites = response.pausedSites;
        updatePauseButton();
        // Close popup - tab is reloading
        setTimeout(() => window.close(), 200);
      }
    });
  });

  refreshPausedList();

  function refreshStatus() {
    if (!currentTabId) return;
    chrome.runtime.sendMessage({ type: "getStatus", tabId: currentTabId }, (response) => {
      if (chrome.runtime.lastError || !response) return;

      toggleSwitch.checked = response.enabled;
      updateProtectionStatus(response.enabled);

      // Site URL - use response URL, or fallback to the URL we got from chrome.tabs.query
      const displayUrl = response.siteUrl || currentTabUrl;
      if (displayUrl) {
        try {
          siteUrlEl.textContent = new URL(displayUrl).hostname;
          siteUrlEl.title = displayUrl;
        } catch (e) { siteUrlEl.textContent = displayUrl; }
      } else {
        siteUrlEl.textContent = "No site loaded";
      }

      // Stats
      const s = response.stats;
      document.getElementById("totalBlocked").textContent = s.total || 0;
      document.getElementById("trackersBlocked").textContent = s.trackers || 0;
      document.getElementById("fingerprintsBlocked").textContent = s.fingerprints || 0;
      document.getElementById("cookiesBlocked").textContent = s.cookies || 0;
      document.getElementById("adsBlocked").textContent = s.ads || 0;

      // Per-protection counts
      const p = s.protections || {};
      const keys = [
        "ip_location", "webrtc", "canvas", "webgl_gpu",
        "font", "screen", "browser_os", "wifi_network",
        "audio_fp", "cookies", "sensors", "ads_scripts"
      ];
      keys.forEach((key) => {
        const el = document.getElementById("p-" + key);
        const count = p[key] || 0;
        if (el) {
          el.textContent = count;
          // Show count with color
          if (count > 0) {
            el.classList.add("active-count");
          } else {
            el.classList.remove("active-count");
          }
        }
        // Update the protection item's dot
        const item = document.querySelector(`.protection-item[data-key="${key}"]`);
        if (item) {
          if (response.enabled && count > 0) {
            item.classList.add("triggered");
            item.classList.remove("inactive");
          } else if (response.enabled) {
            item.classList.add("standby");
            item.classList.remove("triggered", "inactive");
          } else {
            item.classList.add("inactive");
            item.classList.remove("triggered", "standby");
          }
        }
      });

      renderLog(response.log || []);
    });
  }

  function updateProtectionStatus(enabled) {
    protectionItems.forEach((item) => {
      if (!enabled) {
        item.classList.add("inactive");
        item.classList.remove("triggered", "standby");
      }
    });
  }

  function renderLog(entries) {
    if (!entries || entries.length === 0) {
      activityLog.innerHTML = '<div class="log-empty">No blocked requests yet on this page</div>';
      return;
    }

    const html = entries.map((entry) => {
      const time = new Date(entry.time);
      const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const cat = entry.category || "tracker";
      const tagLabels = { tracker: "TRACK", fingerprint: "FP", cookie: "COOKIE", ad: "AD" };
      const tagLabel = tagLabels[cat] || "BLOCK";

      let displayUrl = entry.url || "";
      try {
        if (displayUrl.startsWith("http")) {
          const u = new URL(entry.url);
          displayUrl = u.hostname + u.pathname.substring(0, 40);
        }
      } catch (e) {}

      return `<div class="log-entry ${cat}">
        <span class="log-time">${timeStr}</span>
        <span class="log-tag ${cat}">${tagLabel}</span>
        <span class="log-url" title="${entry.url}">${displayUrl}</span>
      </div>`;
    }).join("");

    activityLog.innerHTML = html;
  }

  // Refresh every second, also re-query the tab URL for reliability
  setInterval(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        const newUrl = tabs[0].url || tabs[0].pendingUrl || "";
        if (newUrl) currentTabUrl = newUrl;
        if (tabs[0].id !== currentTabId) {
          currentTabId = tabs[0].id;
        }
      }
      refreshStatus();
      updatePauseButton();
    });
  }, 1000);
});
