/**
 * Total Privacy Shield - Popup Script
 */

document.addEventListener("DOMContentLoaded", () => {
  const toggleSwitch = document.getElementById("toggleSwitch");
  const statusText = document.getElementById("statusText");
  const resetBtn = document.getElementById("resetStats");
  const protectionItems = document.querySelectorAll(".protection-item");

  // Get current status
  chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
    if (response) {
      updateUI(response.enabled, response.stats);
    }
  });

  // Toggle protection
  toggleSwitch.addEventListener("change", () => {
    chrome.runtime.sendMessage({ type: "toggle" }, (response) => {
      if (response) {
        updateUI(response.enabled, response.stats);
      }
    });
  });

  // Reset stats
  resetBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "resetStats" }, (response) => {
      if (response) {
        updateStatsDisplay(response.stats);
      }
    });
  });

  function updateUI(enabled, stats) {
    toggleSwitch.checked = enabled;

    if (enabled) {
      statusText.textContent = "Protection Active";
      statusText.classList.remove("disabled");
      protectionItems.forEach((item) => {
        item.classList.add("active");
        item.classList.remove("inactive");
        const status = item.querySelector(".status");
        const origText = status.dataset.origText || status.textContent;
        status.dataset.origText = origText;
        status.textContent = origText;
      });
    } else {
      statusText.textContent = "Protection Disabled";
      statusText.classList.add("disabled");
      protectionItems.forEach((item) => {
        item.classList.remove("active");
        item.classList.add("inactive");
        const status = item.querySelector(".status");
        if (!status.dataset.origText) {
          status.dataset.origText = status.textContent;
        }
        status.textContent = "Off";
      });
    }

    updateStatsDisplay(stats);
  }

  function updateStatsDisplay(stats) {
    document.getElementById("trackersBlocked").textContent =
      formatNumber(stats.trackersBlocked);
    document.getElementById("fingerprintsBlocked").textContent =
      formatNumber(stats.fingerprintsBlocked);
    document.getElementById("cookiesBlocked").textContent =
      formatNumber(stats.cookiesBlocked);
    document.getElementById("totalBlocked").textContent =
      formatNumber(stats.totalBlocked);
  }

  function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K";
    return num.toString();
  }

  // Auto-refresh stats every 2 seconds
  setInterval(() => {
    chrome.runtime.sendMessage({ type: "getStatus" }, (response) => {
      if (response) {
        updateStatsDisplay(response.stats);
      }
    });
  }, 2000);
});
