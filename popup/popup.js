/**
 * Total Privacy Shield - Popup v4
 * Per-tab stats with per-protection counts
 */

document.addEventListener("DOMContentLoaded", () => {
  const toggleSwitch = document.getElementById("toggleSwitch");
  const siteUrlEl = document.getElementById("siteUrl");
  const activityLog = document.getElementById("activityLog");
  const protectionItems = document.querySelectorAll(".protection-item");
  let currentTabId = null;

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

  function refreshStatus() {
    if (!currentTabId) return;
    chrome.runtime.sendMessage({ type: "getStatus", tabId: currentTabId }, (response) => {
      if (chrome.runtime.lastError || !response) return;

      toggleSwitch.checked = response.enabled;
      updateProtectionStatus(response.enabled);

      // Site URL
      if (response.siteUrl) {
        try {
          siteUrlEl.textContent = new URL(response.siteUrl).hostname;
          siteUrlEl.title = response.siteUrl;
        } catch (e) { siteUrlEl.textContent = response.siteUrl; }
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

  setInterval(refreshStatus, 1000);
});
