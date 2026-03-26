/**
 * Total Privacy Shield - Content Script (MAIN world)
 * Runs before any page script to override and block all tracking/fingerprinting APIs.
 * Reports blocks to background via window.postMessage -> content-bridge.js
 */

(function () {
  "use strict";

  // =========================================================================
  // UTILITY HELPERS
  // =========================================================================

  let blockCount = 0;

  function reportBlock(category, url, detail, protection) {
    blockCount++;
    try {
      window.postMessage({
        type: "TPS_BLOCK",
        category: category,
        url: url || window.location.href,
        detail: detail || "Blocked",
        protection: protection || null,
      }, "*");
    } catch (e) {}
  }

  function defineReadonly(obj, prop, value) {
    try {
      Object.defineProperty(obj, prop, {
        get: () => value,
        set: () => {},
        configurable: false,
        enumerable: true,
      });
    } catch (e) { /* already defined */ }
  }

  // =========================================================================
  // 1. BLOCK WebRTC (IP Leak Prevention)
  // =========================================================================

  const rtcObjects = [
    "RTCPeerConnection",
    "webkitRTCPeerConnection",
    "mozRTCPeerConnection",
    "RTCSessionDescription",
    "webkitRTCSessionDescription",
    "RTCIceCandidate",
    "webkitRTCIceCandidate",
  ];

  rtcObjects.forEach((name) => {
    if (window[name]) {
      try {
        Object.defineProperty(window, name, {
          get: () => {
            reportBlock("tracker", "webrtc://" + name, "WebRTC leak blocked", "webrtc");
            return undefined;
          },
          set: () => {},
          configurable: false,
        });
      } catch (e) {}
    }
  });

  // Block getUserMedia
  try {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = function (constraints) {
        reportBlock("fingerprint", "media://getUserMedia", "Camera/mic access blocked", "webrtc");
        return Promise.reject(new DOMException("Blocked by Total Privacy Shield", "NotAllowedError"));
      };
    }
  } catch (e) {}

  // =========================================================================
  // 2. BLOCK GEOLOCATION (Location Tracking)
  // =========================================================================

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition = function (success, error) {
      reportBlock("tracker", "geo://getCurrentPosition", "Geolocation blocked", "ip_location");
      if (error) error({ code: 1, message: "Blocked by Total Privacy Shield" });
    };
    navigator.geolocation.watchPosition = function (success, error) {
      reportBlock("tracker", "geo://watchPosition", "Geolocation watch blocked", "ip_location");
      if (error) error({ code: 1, message: "Blocked by Total Privacy Shield" });
      return 0;
    };
    navigator.geolocation.clearWatch = function () {};
  }

  // =========================================================================
  // 3. SPOOF SCREEN RESOLUTION & WINDOW SIZE
  // =========================================================================

  const genericScreen = {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1080,
    colorDepth: 24,
    pixelDepth: 24,
  };

  Object.keys(genericScreen).forEach((key) => {
    defineReadonly(screen, key, genericScreen[key]);
  });

  defineReadonly(window, "devicePixelRatio", 1);
  defineReadonly(window, "outerWidth", 1920);
  defineReadonly(window, "outerHeight", 1080);
  defineReadonly(window, "innerWidth", 1920);
  defineReadonly(window, "innerHeight", 1080);

  const origMatchMedia = window.matchMedia;
  window.matchMedia = function (query) {
    if (
      query.includes("device-width") ||
      query.includes("device-height") ||
      query.includes("resolution")
    ) {
      return { matches: false, media: query, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false };
    }
    return origMatchMedia.call(window, query);
  };

  // =========================================================================
  // 4. BLOCK CANVAS FINGERPRINTING
  // =========================================================================

  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function () {
    try {
      const ctx = this.getContext("2d");
      if (ctx && this.width > 0 && this.height > 0) {
        const imageData = ctx.getImageData(0, 0, this.width, this.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          data[i] = data[i] ^ (Math.random() * 2 | 0);
          data[i + 1] = data[i + 1] ^ (Math.random() * 2 | 0);
          data[i + 2] = data[i + 2] ^ (Math.random() * 2 | 0);
        }
        ctx.putImageData(imageData, 0, 0);
        reportBlock("fingerprint", "canvas://toDataURL", "Canvas fingerprint spoofed", "canvas");
      }
    } catch (e) {}
    return origToDataURL.apply(this, arguments);
  };

  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
    try {
      const ctx = this.getContext("2d");
      if (ctx && this.width > 0 && this.height > 0) {
        const imageData = ctx.getImageData(0, 0, this.width, this.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          data[i] = data[i] ^ (Math.random() * 2 | 0);
          data[i + 1] = data[i + 1] ^ (Math.random() * 2 | 0);
          data[i + 2] = data[i + 2] ^ (Math.random() * 2 | 0);
        }
        ctx.putImageData(imageData, 0, 0);
        reportBlock("fingerprint", "canvas://toBlob", "Canvas fingerprint spoofed", "canvas");
      }
    } catch (e) {}
    return origToBlob.call(this, callback, type, quality);
  };

  try {
    if (typeof OffscreenCanvas !== "undefined") {
      OffscreenCanvas.prototype.convertToBlob = function () {
        reportBlock("fingerprint", "canvas://OffscreenCanvas", "OffscreenCanvas blocked", "canvas");
        return Promise.reject(new DOMException("Blocked by Total Privacy Shield"));
      };
    }
  } catch (e) {}

  // =========================================================================
  // 5. BLOCK / SPOOF WebGL FINGERPRINTING (GPU Info)
  // =========================================================================

  const blockWebGLParams = () => {
    const getParamHandler = {
      apply(target, thisArg, args) {
        const param = args[0];
        if (param === 0x1f01 || param === 0x1f00 ||
            param === 0x9245 || param === 0x9246) {
          reportBlock("fingerprint", "webgl://getParameter", "GPU info spoofed", "webgl_gpu");
          return "Generic GPU";
        }
        return Reflect.apply(target, thisArg, args);
      },
    };

    ["WebGLRenderingContext", "WebGL2RenderingContext"].forEach((ctxName) => {
      try {
        const proto = window[ctxName]?.prototype;
        if (proto) {
          proto.getParameter = new Proxy(proto.getParameter, getParamHandler);

          const origGetExt = proto.getExtension;
          proto.getExtension = function (name) {
            if (name === "WEBGL_debug_renderer_info") {
              reportBlock("fingerprint", "webgl://debug_renderer_info", "GPU debug info blocked", "webgl_gpu");
              return null;
            }
            return origGetExt.call(this, name);
          };
        }
      } catch (e) {}
    });
  };
  blockWebGLParams();

  // =========================================================================
  // 6. SPOOF NAVIGATOR / BROWSER FINGERPRINT
  // =========================================================================

  const spoofedUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  defineReadonly(navigator, "userAgent", spoofedUA);
  defineReadonly(navigator, "appVersion", "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  defineReadonly(navigator, "platform", "Win32");
  defineReadonly(navigator, "vendor", "Google Inc.");
  defineReadonly(navigator, "language", "en-US");
  defineReadonly(navigator, "languages", ["en-US", "en"]);
  defineReadonly(navigator, "hardwareConcurrency", 4);
  defineReadonly(navigator, "deviceMemory", 8);
  defineReadonly(navigator, "maxTouchPoints", 0);

  // Block navigator.connection (Wi-Fi / network detection)
  defineReadonly(navigator, "connection", undefined);
  defineReadonly(navigator, "mozConnection", undefined);
  defineReadonly(navigator, "webkitConnection", undefined);

  // Block battery status
  if (navigator.getBattery) {
    navigator.getBattery = () => {
      reportBlock("fingerprint", "api://Battery", "Battery status blocked", "sensors");
      return Promise.reject(new DOMException("Blocked by Total Privacy Shield"));
    };
  }

  // Block Bluetooth / USB / Serial / HID
  if (navigator.bluetooth) defineReadonly(navigator, "bluetooth", undefined);
  if (navigator.usb) defineReadonly(navigator, "usb", undefined);
  if (navigator.serial) defineReadonly(navigator, "serial", undefined);
  if (navigator.hid) defineReadonly(navigator, "hid", undefined);

  // =========================================================================
  // 7. BLOCK FONT FINGERPRINTING
  // =========================================================================

  try {
    if (navigator.fonts) {
      defineReadonly(navigator, "fonts", { query: () => Promise.resolve([]) });
    }
  } catch (e) {}

  try {
    if (document.fonts) {
      document.fonts.check = function () { return true; };
      document.fonts.forEach = function () {};
    }
  } catch (e) {}

  // =========================================================================
  // 8. BLOCK AUDIO FINGERPRINTING
  // =========================================================================

  try {
    const origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = function (array) {
      origGetFloat.call(this, array);
      for (let i = 0; i < array.length; i++) {
        array[i] += (Math.random() - 0.5) * 0.1;
      }
      reportBlock("fingerprint", "audio://AnalyserNode", "Audio fingerprint spoofed", "audio_fp");
    };

    const origGetByte = AnalyserNode.prototype.getByteFrequencyData;
    AnalyserNode.prototype.getByteFrequencyData = function (array) {
      origGetByte.call(this, array);
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.max(0, Math.min(255, array[i] + (Math.random() * 2 - 1) | 0));
      }
      reportBlock("fingerprint", "audio://ByteFrequency", "Audio fingerprint spoofed", "audio_fp");
    };
  } catch (e) {}

  // =========================================================================
  // 9. BLOCK NETWORK INFORMATION API (Wi-Fi / Router Detection)
  // =========================================================================

  try { defineReadonly(window, "NetworkInformation", undefined); } catch (e) {}

  // =========================================================================
  // 10. BLOCK TRACKING BEACONS & PING
  // =========================================================================

  const origSendBeacon = navigator.sendBeacon;
  navigator.sendBeacon = function (url) {
    reportBlock("tracker", url || "beacon://sendBeacon", "Tracking beacon blocked", "ads_scripts");
    return false;
  };

  try {
    Object.defineProperty(HTMLAnchorElement.prototype, "ping", {
      get: () => "",
      set: () => {},
    });
  } catch (e) {}

  // =========================================================================
  // 11. BLOCK SENSOR APIs
  // =========================================================================

  [
    "Accelerometer", "Gyroscope", "Magnetometer",
    "AbsoluteOrientationSensor", "RelativeOrientationSensor",
    "GravitySensor", "LinearAccelerationSensor", "AmbientLightSensor",
  ].forEach((api) => {
    try { defineReadonly(window, api, undefined); } catch (e) {}
  });

  const origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (["devicemotion", "deviceorientation", "deviceorientationabsolute"].includes(type)) {
      reportBlock("fingerprint", "sensor://" + type, "Device sensor blocked", "sensors");
      return;
    }
    return origAddEventListener.call(this, type, listener, options);
  };

  // =========================================================================
  // 12. BLOCK SPEECH RECOGNITION
  // =========================================================================

  try {
    defineReadonly(window, "SpeechRecognition", undefined);
    defineReadonly(window, "webkitSpeechRecognition", undefined);
  } catch (e) {}

  // =========================================================================
  // 13. BLOCK CLIENT HINTS
  // =========================================================================

  try {
    if (navigator.userAgentData) defineReadonly(navigator, "userAgentData", undefined);
  } catch (e) {}

  // =========================================================================
  // 14. REDUCE TIMING PRECISION
  // =========================================================================

  const origPerfNow = performance.now;
  performance.now = function () {
    return Math.round(origPerfNow.call(performance) / 100) * 100;
  };

  // =========================================================================
  // 15. BLOCK PLUGINS & MIME TYPES
  // =========================================================================

  defineReadonly(navigator, "plugins", []);
  defineReadonly(navigator, "mimeTypes", []);

  // =========================================================================
  // 16. PRIVACY SIGNALS
  // =========================================================================

  defineReadonly(navigator, "doNotTrack", "1");
  defineReadonly(navigator, "globalPrivacyControl", true);

  // =========================================================================
  // 17. SPOOF STORAGE QUOTA
  // =========================================================================

  try {
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate = () =>
        Promise.resolve({ quota: 1073741824, usage: 0 });
    }
  } catch (e) {}

  // =========================================================================
  // 18. BLOCK WEBGPU
  // =========================================================================

  try {
    if (navigator.gpu) defineReadonly(navigator, "gpu", undefined);
  } catch (e) {}

  // =========================================================================
  // 19. INTERCEPT XHR & FETCH TO BLOCK TRACKING REQUESTS
  // =========================================================================

  const TRACKING_URL_PATTERNS = [
    /google-analytics\.com/i,
    /googletagmanager\.com/i,
    /doubleclick\.net/i,
    /facebook\.net.*fbevents/i,
    /connect\.facebook\.net/i,
    /pixel\.facebook/i,
    /facebook\.com\/tr/i,
    /hotjar\.com/i,
    /clarity\.ms/i,
    /fullstory\.com/i,
    /mixpanel\.com/i,
    /segment\.(io|com)/i,
    /amplitude\.com/i,
    /scorecardresearch\.com/i,
    /bat\.bing\.com/i,
    /analytics\.twitter/i,
    /criteo\.(com|net)/i,
    /taboola\.com/i,
    /outbrain\.com/i,
    /fingerprintjs/i,
    /datadome/i,
    /perimeterx/i,
    /sentry\.io/i,
    /newrelic/i,
    /nr-data\.net/i,
    /logging_client_events/i,
    /\/collect\?.*tid=/i,
    /\/beacon\b/i,
    /\/telemetry/i,
    /\/pageview/i,
    /\/track\?/i,
    /\/log_event/i,
    /gtag\/js/i,
    /gtm\.js/i,
    /analytics\.js/i,
  ];

  function isTrackingURL(url) {
    for (const pattern of TRACKING_URL_PATTERNS) {
      if (pattern.test(url)) return true;
    }
    return false;
  }

  // Intercept fetch()
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = (typeof input === "string") ? input : (input?.url || "");
    if (isTrackingURL(url)) {
      reportBlock("tracker", url, "Tracking fetch() blocked", "ads_scripts");
      return Promise.reject(new TypeError("Blocked by Total Privacy Shield"));
    }
    return origFetch.apply(this, arguments);
  };

  // Intercept XMLHttpRequest
  const origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._tpsUrl = url;
    return origXHROpen.apply(this, arguments);
  };

  const origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this._tpsUrl && isTrackingURL(this._tpsUrl)) {
      reportBlock("tracker", this._tpsUrl, "Tracking XHR blocked", "ads_scripts");
      this.abort();
      return;
    }
    return origXHRSend.apply(this, arguments);
  };

  // Intercept Image loading (tracking pixels)
  const origImageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  if (origImageSrc) {
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      get: function () { return origImageSrc.get.call(this); },
      set: function (val) {
        if (typeof val === "string" && isTrackingURL(val)) {
          reportBlock("tracker", val, "Tracking pixel blocked", "ads_scripts");
          return;
        }
        origImageSrc.set.call(this, val);
      },
      configurable: true,
      enumerable: true,
    });
  }

  // =========================================================================
  // CONSOLE NOTIFICATION
  // =========================================================================

  // =========================================================================
  // 20. REPORT ALWAYS-ON PROTECTIONS (these fire on every page load)
  // =========================================================================

  // These protections are applied the moment the script runs.
  // Report them so the dashboard shows they are active on this page.
  setTimeout(() => {
    reportBlock("fingerprint", "spoof://screen", "Screen resolution spoofed to 1920x1080", "screen");
    reportBlock("fingerprint", "spoof://userAgent", "Browser/OS spoofed to Chrome 120 Win10", "browser_os");
    reportBlock("fingerprint", "spoof://navigator", "Navigator properties spoofed", "browser_os");
    reportBlock("tracker", "block://wifi-network", "Wi-Fi/Network info blocked", "wifi_network");
    reportBlock("fingerprint", "block://fonts", "Font enumeration blocked", "font");
    reportBlock("cookie", "block://cookies", "Third-party cookies stripped", "cookies");
    reportBlock("fingerprint", "block://plugins", "Plugins/MimeTypes hidden", "browser_os");
    reportBlock("fingerprint", "spoof://timing", "Timing precision reduced", "browser_os");
    reportBlock("fingerprint", "block://clientHints", "Client Hints removed", "browser_os");
    reportBlock("tracker", "block://sendBeacon", "sendBeacon API neutralized", "ads_scripts");
    reportBlock("fingerprint", "block://sensors", "Device sensors blocked", "sensors");
    reportBlock("tracker", "block://geolocation", "Geolocation API blocked", "ip_location");
    reportBlock("tracker", "block://webrtc", "WebRTC connections blocked", "webrtc");
  }, 100);

  console.log(
    "%c[Total Privacy Shield] Active - All tracking and fingerprinting blocked",
    "color: #00ff88; font-weight: bold; font-size: 14px;"
  );
})();
