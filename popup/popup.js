/**
 * Total Privacy Shield - Popup v3
 * Per-tab real stats, live activity log
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

  // Get current tab ID first
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      currentTabId = tabs[0].id;
      refreshStatus();
    }
  });

  // Toggle
  toggleSwitch.addEventListener("change", () => {
    chrome.runtime.sendMessage({ type: "toggle" }, (response) => {
      if (response) {
        toggleSwitch.checked = response.enabled;
        updateProtectionStatus(response.enabled);
      }
    });
  });

  // Reset
  document.getElementById("resetStats").addEventListener("click", () => {
    if (currentTabId) {
      chrome.runtime.sendMessage({ type: "resetTabStats", tabId: currentTabId }, () => {
        refreshStatus();
      });
    }
  });

  // Clear log
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
          const url = new URL(response.siteUrl);
          siteUrlEl.textContent = url.hostname;
          siteUrlEl.title = response.siteUrl;
        } catch (e) {
          siteUrlEl.textContent = response.siteUrl;
        }
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

      // Animate total if > 0
      const bigVal = document.getElementById("totalBlocked");
      if (s.total > 0) {
        bigVal.style.color = "#00ff88";
      }

      // Activity log
      renderLog(response.log || []);
    });
  }

  function updateProtectionStatus(enabled) {
    protectionItems.forEach((item) => {
      if (enabled) {
        item.classList.add("active");
        item.classList.remove("inactive");
      } else {
        item.classList.remove("active");
        item.classList.add("inactive");
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
      const tagLabel = cat === "fingerprint" ? "FP" : cat === "cookie" ? "COOKIE" : cat === "ad" ? "AD" : "TRACK";

      // Extract domain from URL for cleaner display
      let displayUrl = entry.url || "";
      try {
        const urlObj = new URL(entry.url);
        displayUrl = urlObj.hostname + urlObj.pathname.substring(0, 40);
      } catch (e) {
        displayUrl = entry.url;
      }

      return `<div class="log-entry ${cat}">
        <span class="log-time">${timeStr}</span>
        <span class="log-tag ${cat}">${tagLabel}</span>
        <span class="log-url" title="${entry.url}">${displayUrl}</span>
      </div>`;
    }).join("");

    activityLog.innerHTML = html;
  }

  // Auto-refresh every 1 second for real-time feel
  setInterval(refreshStatus, 1000);
});
