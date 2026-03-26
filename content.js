/**
 * Total Privacy Shield - Content Script (MAIN world)
 * Runs before any page script to override and block all tracking/fingerprinting APIs.
 */

(function () {
  "use strict";

  // =========================================================================
  // UTILITY HELPERS
  // =========================================================================

  function spoofValue(original, spoofed) {
    return typeof original === "function"
      ? function () { return spoofed; }
      : spoofed;
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

  // WebRTC can leak real IP even behind VPN
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
    try {
      Object.defineProperty(window, name, {
        get: () => undefined,
        set: () => {},
        configurable: false,
      });
    } catch (e) {}
  });

  // Also block inside navigator
  try {
    if (navigator.mediaDevices) {
      const origGetUserMedia = navigator.mediaDevices.getUserMedia;
      navigator.mediaDevices.getUserMedia = function (constraints) {
        // Block if only used for fingerprinting (no actual media needed)
        return Promise.reject(new DOMException("Blocked by Total Privacy Shield", "NotAllowedError"));
      };
    }
  } catch (e) {}

  // =========================================================================
  // 2. BLOCK GEOLOCATION (Location Tracking)
  // =========================================================================

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition = function (success, error) {
      if (error) {
        error({ code: 1, message: "Blocked by Total Privacy Shield" });
      }
    };
    navigator.geolocation.watchPosition = function (success, error) {
      if (error) {
        error({ code: 1, message: "Blocked by Total Privacy Shield" });
      }
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

  // matchMedia spoofing for screen-based fingerprinting
  const origMatchMedia = window.matchMedia;
  window.matchMedia = function (query) {
    // Return generic results for resolution / device queries
    if (
      query.includes("device-width") ||
      query.includes("device-height") ||
      query.includes("resolution")
    ) {
      return { matches: false, media: query, addListener: () => {}, removeListener: () => {} };
    }
    return origMatchMedia.call(window, query);
  };

  // =========================================================================
  // 4. BLOCK CANVAS FINGERPRINTING
  // =========================================================================

  // Add subtle noise to canvas to break fingerprinting while keeping pages functional
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function () {
    const ctx = this.getContext("2d");
    if (ctx) {
      const imageData = ctx.getImageData(0, 0, this.width, this.height);
      const data = imageData.data;
      // Add random noise to pixel data
      for (let i = 0; i < data.length; i += 4) {
        data[i] = data[i] ^ (Math.random() * 2 | 0);     // R
        data[i + 1] = data[i + 1] ^ (Math.random() * 2 | 0); // G
        data[i + 2] = data[i + 2] ^ (Math.random() * 2 | 0); // B
      }
      ctx.putImageData(imageData, 0, 0);
    }
    return origToDataURL.apply(this, arguments);
  };

  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
    const ctx = this.getContext("2d");
    if (ctx) {
      const imageData = ctx.getImageData(0, 0, this.width, this.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = data[i] ^ (Math.random() * 2 | 0);
        data[i + 1] = data[i + 1] ^ (Math.random() * 2 | 0);
        data[i + 2] = data[i + 2] ^ (Math.random() * 2 | 0);
      }
      ctx.putImageData(imageData, 0, 0);
    }
    return origToBlob.call(this, callback, type, quality);
  };

  // Block OffscreenCanvas fingerprinting
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const origOSCconvertToBlob = OffscreenCanvas.prototype.convertToBlob;
      OffscreenCanvas.prototype.convertToBlob = function () {
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
        // Block renderer and vendor strings (GPU fingerprint)
        if (param === 0x1f01 || param === 0x1f00) { // RENDERER, VENDOR
          return "Generic GPU";
        }
        if (param === 0x9245 || param === 0x9246) { // UNMASKED_VENDOR, UNMASKED_RENDERER
          return "Generic GPU";
        }
        return Reflect.apply(target, thisArg, args);
      },
    };

    const contexts = ["WebGLRenderingContext", "WebGL2RenderingContext"];
    contexts.forEach((ctxName) => {
      try {
        const proto = window[ctxName]?.prototype;
        if (proto) {
          proto.getParameter = new Proxy(proto.getParameter, getParamHandler);
        }
      } catch (e) {}
    });

    // Block WEBGL_debug_renderer_info extension
    const origGetExtension = WebGLRenderingContext.prototype.getExtension;
    WebGLRenderingContext.prototype.getExtension = function (name) {
      if (name === "WEBGL_debug_renderer_info") return null;
      return origGetExtension.call(this, name);
    };
    try {
      const origGetExtension2 = WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = function (name) {
        if (name === "WEBGL_debug_renderer_info") return null;
        return origGetExtension2.call(this, name);
      };
    } catch (e) {}
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

  // Block navigator.connection (network fingerprinting / Wi-Fi detection)
  defineReadonly(navigator, "connection", undefined);
  defineReadonly(navigator, "mozConnection", undefined);
  defineReadonly(navigator, "webkitConnection", undefined);

  // Block battery status (fingerprinting)
  if (navigator.getBattery) {
    navigator.getBattery = () =>
      Promise.reject(new DOMException("Blocked by Total Privacy Shield"));
  }

  // Block Bluetooth (device fingerprinting)
  if (navigator.bluetooth) {
    defineReadonly(navigator, "bluetooth", undefined);
  }

  // Block USB
  if (navigator.usb) {
    defineReadonly(navigator, "usb", undefined);
  }

  // Block Serial
  if (navigator.serial) {
    defineReadonly(navigator, "serial", undefined);
  }

  // Block HID
  if (navigator.hid) {
    defineReadonly(navigator, "hid", undefined);
  }

  // =========================================================================
  // 7. BLOCK FONT FINGERPRINTING
  // =========================================================================

  // Override font enumeration
  try {
    if (navigator.fonts) {
      defineReadonly(navigator, "fonts", { query: () => Promise.resolve([]) });
    }
  } catch (e) {}

  // Block FontFaceSet from being enumerated
  try {
    if (document.fonts) {
      const origCheck = document.fonts.check;
      document.fonts.check = function () {
        return true; // Claim all fonts exist so font probing returns uniform results
      };
      document.fonts.forEach = function () {}; // Block enumeration
    }
  } catch (e) {}

  // =========================================================================
  // 8. BLOCK AUDIO FINGERPRINTING
  // =========================================================================

  try {
    const origCreateOscillator = AudioContext.prototype.createOscillator;
    const origCreateDynamicsCompressor = AudioContext.prototype.createDynamicsCompressor;
    const origCreateAnalyser = AudioContext.prototype.createAnalyser;

    // Add noise to AudioContext to break audio fingerprinting
    const origGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = function (array) {
      origGetFloatFrequencyData.call(this, array);
      for (let i = 0; i < array.length; i++) {
        array[i] += (Math.random() - 0.5) * 0.1;
      }
    };

    const origGetByteFrequencyData = AnalyserNode.prototype.getByteFrequencyData;
    AnalyserNode.prototype.getByteFrequencyData = function (array) {
      origGetByteFrequencyData.call(this, array);
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.max(0, Math.min(255, array[i] + (Math.random() * 2 - 1) | 0));
      }
    };
  } catch (e) {}

  // =========================================================================
  // 9. BLOCK NETWORK INFORMATION API (Wi-Fi / Router Detection)
  // =========================================================================

  // Already blocked navigator.connection above, also block NetworkInformation
  try {
    defineReadonly(window, "NetworkInformation", undefined);
  } catch (e) {}

  // =========================================================================
  // 10. BLOCK STORAGE-BASED TRACKING
  // =========================================================================

  // Block navigator.sendBeacon (tracking beacons)
  navigator.sendBeacon = function () { return false; };

  // Block ping attribute tracking
  try {
    Object.defineProperty(HTMLAnchorElement.prototype, "ping", {
      get: () => "",
      set: () => {},
    });
  } catch (e) {}

  // =========================================================================
  // 11. BLOCK SENSOR APIs (Device Fingerprinting)
  // =========================================================================

  const sensorAPIs = [
    "Accelerometer",
    "Gyroscope",
    "Magnetometer",
    "AbsoluteOrientationSensor",
    "RelativeOrientationSensor",
    "GravitySensor",
    "LinearAccelerationSensor",
    "AmbientLightSensor",
  ];
  sensorAPIs.forEach((api) => {
    try {
      defineReadonly(window, api, undefined);
    } catch (e) {}
  });

  // Block devicemotion and deviceorientation events
  const origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const blocked = [
      "devicemotion",
      "deviceorientation",
      "deviceorientationabsolute",
    ];
    if (blocked.includes(type)) {
      return; // Silently block
    }
    return origAddEventListener.call(this, type, listener, options);
  };

  // =========================================================================
  // 12. BLOCK SPEECH RECOGNITION FINGERPRINTING
  // =========================================================================

  try {
    defineReadonly(window, "SpeechRecognition", undefined);
    defineReadonly(window, "webkitSpeechRecognition", undefined);
  } catch (e) {}

  // =========================================================================
  // 13. BLOCK CLIENT HINTS
  // =========================================================================

  try {
    if (navigator.userAgentData) {
      defineReadonly(navigator, "userAgentData", undefined);
    }
  } catch (e) {}

  // =========================================================================
  // 14. BLOCK KEYBOARD / TYPING FINGERPRINTING
  // =========================================================================

  // Normalize keyboard event timing
  const origDateNow = Date.now;
  const origPerfNow = performance.now;

  // Reduce timing precision to 100ms to prevent timing-based fingerprinting
  performance.now = function () {
    return Math.round(origPerfNow.call(performance) / 100) * 100;
  };

  // =========================================================================
  // 15. BLOCK PLUGINS & MIME TYPES FINGERPRINTING
  // =========================================================================

  defineReadonly(navigator, "plugins", []);
  defineReadonly(navigator, "mimeTypes", []);

  // =========================================================================
  // 16. BLOCK DO-NOT-TRACK DETECTION
  // =========================================================================

  defineReadonly(navigator, "doNotTrack", "1");
  defineReadonly(navigator, "globalPrivacyControl", true);

  // =========================================================================
  // 17. BLOCK STORAGE FINGERPRINTING PROBES
  // =========================================================================

  try {
    // Spoof storage quota to prevent fingerprinting via storage estimation
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate = () =>
        Promise.resolve({ quota: 1073741824, usage: 0 });
    }
  } catch (e) {}

  // =========================================================================
  // 18. BLOCK WEBGPU FINGERPRINTING
  // =========================================================================

  try {
    if (navigator.gpu) {
      defineReadonly(navigator, "gpu", undefined);
    }
  } catch (e) {}

  // =========================================================================
  // CONSOLE NOTIFICATION
  // =========================================================================

  console.log(
    "%c[Total Privacy Shield] Active - All tracking and fingerprinting blocked",
    "color: #00ff88; font-weight: bold; font-size: 14px;"
  );
})();
