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

  function reportBlock(category) {
    blockCount++;
    try {
      window.postMessage({ type: "TPS_BLOCK", category: category }, "*");
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
            reportBlock("trackersBlocked");
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
        reportBlock("fingerprintsBlocked");
        return Promise.reject(new DOMException("Blocked by Total Privacy Shield", "NotAllowedError"));
      };
    }
  } catch (e) {}

  // =========================================================================
  // 2. BLOCK GEOLOCATION (Location Tracking)
  // =========================================================================

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition = function (success, error) {
      reportBlock("trackersBlocked");
      if (error) error({ code: 1, message: "Blocked by Total Privacy Shield" });
    };
    navigator.geolocation.watchPosition = function (success, error) {
      reportBlock("trackersBlocked");
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
        reportBlock("fingerprintsBlocked");
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
        reportBlock("fingerprintsBlocked");
      }
    } catch (e) {}
    return origToBlob.call(this, callback, type, quality);
  };

  try {
    if (typeof OffscreenCanvas !== "undefined") {
      OffscreenCanvas.prototype.convertToBlob = function () {
        reportBlock("fingerprintsBlocked");
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
          reportBlock("fingerprintsBlocked");
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
              reportBlock("fingerprintsBlocked");
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
      reportBlock("fingerprintsBlocked");
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
      reportBlock("fingerprintsBlocked");
    };

    const origGetByte = AnalyserNode.prototype.getByteFrequencyData;
    AnalyserNode.prototype.getByteFrequencyData = function (array) {
      origGetByte.call(this, array);
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.max(0, Math.min(255, array[i] + (Math.random() * 2 - 1) | 0));
      }
      reportBlock("fingerprintsBlocked");
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
  navigator.sendBeacon = function () {
    reportBlock("trackersBlocked");
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
      reportBlock("fingerprintsBlocked");
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
      reportBlock("trackersBlocked");
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
      reportBlock("trackersBlocked");
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
          reportBlock("trackersBlocked");
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

  console.log(
    "%c[Total Privacy Shield] Active - All tracking and fingerprinting blocked",
    "color: #00ff88; font-weight: bold; font-size: 14px;"
  );
})();
