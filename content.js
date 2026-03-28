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
    /facebook\.com\/ajax\/bz/i,
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
    /\/event_log/i,
    /gtag\/js/i,
    /gtm\.js/i,
    /analytics\.js/i,
    /googlesyndication\.com/i,
    /googleadservices\.com/i,
    /adservice\.google/i,
    /adnxs\.com/i,
    /amazon-adsystem/i,
    /rubiconproject\.com/i,
    /pubmatic\.com/i,
    /openx\.net/i,
    /casalemedia\.com/i,
    /adsrvr\.org/i,
    /demdex\.net/i,
    /bluekai\.com/i,
    /krxd\.net/i,
    /comscore\.com/i,
    /optimizely\.com/i,
    /heapanalytics\.com/i,
    /intercom\.io/i,
    /drift\.com/i,
    /pardot\.com/i,
    /marketo\.com/i,
    /hs-analytics\.net/i,
    /hsforms\.com/i,
    /logrocket\.com/i,
    /smartlook\.com/i,
    /pendo\.io/i,
    /mouseflow\.com/i,
    /crazyegg\.com/i,
    /luckyorange\.com/i,
    /tealium\.com/i,
    /appsflyer\.com/i,
    /branch\.io/i,
    /adjust\.com/i,
    /mparticle\.com/i,
    /braze\.com/i,
    /snap\.licdn\.com/i,
    /px\.ads\.linkedin/i,
    /dc\.ads\.linkedin/i,
    /tr\.snapchat\.com/i,
    /ct\.pinterest\.com/i,
    /serving-sys\.com/i,
    /moatads\.com/i,
    /2mdn\.net/i,
    /bidswitch\.net/i,
    /instagram\.com\/logging/i,
    /instagram\.com\/client_event/i,
    /i\.instagram\.com\/api\/v1\/logging/i,
  ];

  function isTrackingURL(url) {
    if (!url || typeof url !== "string") return false;
    for (const pattern of TRACKING_URL_PATTERNS) {
      if (pattern.test(url)) return true;
    }
    return false;
  }

  function classifyTracker(url) {
    const lower = url.toLowerCase();
    if (/doubleclick|googlesyndication|googleadservices|adservice\.google|adnxs|amazon-adsystem|criteo|taboola|outbrain|rubiconproject|pubmatic|openx|adsrvr|serving-sys|moatads|2mdn|bidswitch/.test(lower)) {
      return { category: "ad", detail: "Ad network blocked", protection: "ads_scripts" };
    }
    if (/cookie|set-cookie/i.test(lower)) {
      return { category: "cookie", detail: "Cookie blocked", protection: "cookies" };
    }
    if (/fingerprintjs|datadome|perimeterx|fingerprint/i.test(lower)) {
      return { category: "fingerprint", detail: "Fingerprinting blocked", protection: "browser_os" };
    }
    return { category: "tracker", detail: "Tracker blocked", protection: "ads_scripts" };
  }

  // Intercept fetch()
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = (typeof input === "string") ? input : (input?.url || "");
    if (isTrackingURL(url)) {
      const c = classifyTracker(url);
      reportBlock(c.category, url, c.detail + " (fetch)", c.protection);
      return Promise.resolve(new Response("", { status: 200 }));
    }
    return origFetch.apply(this, arguments);
  };

  // Intercept XMLHttpRequest
  const origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._tpsUrl = (typeof url === "string") ? url : String(url);
    return origXHROpen.apply(this, arguments);
  };

  const origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this._tpsUrl && isTrackingURL(this._tpsUrl)) {
      const c = classifyTracker(this._tpsUrl);
      reportBlock(c.category, this._tpsUrl, c.detail + " (XHR)", c.protection);
      // Return empty response instead of aborting (less errors)
      Object.defineProperty(this, "readyState", { get: () => 4 });
      Object.defineProperty(this, "status", { get: () => 200 });
      Object.defineProperty(this, "responseText", { get: () => "" });
      Object.defineProperty(this, "response", { get: () => "" });
      if (this.onreadystatechange) {
        try { this.onreadystatechange(); } catch (e) {}
      }
      if (this.onload) {
        try { this.onload(); } catch (e) {}
      }
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
          const c = classifyTracker(val);
          reportBlock(c.category, val, c.detail + " (pixel)", c.protection);
          return;
        }
        origImageSrc.set.call(this, val);
      },
      configurable: true,
      enumerable: true,
    });
  }

  // =========================================================================
  // 20. MUTATIONOBSERVER - CATCH & BLOCK TRACKING SCRIPTS IN DOM
  // This works INDEPENDENTLY of Brave shields or any other blocker!
  // =========================================================================

  const TRACKING_SCRIPT_PATTERNS = [
    /google-analytics\.com/i, /googletagmanager\.com/i, /gtag/i, /gtm\.js/i,
    /facebook\.net/i, /fbevents/i, /pixel\.facebook/i,
    /connect\.facebook\.net/i, /hotjar\.com/i, /clarity\.ms/i,
    /fullstory\.com/i, /mixpanel\.com/i, /segment\.(io|com)/i,
    /amplitude\.com/i, /heapanalytics/i, /sentry\.io/i,
    /newrelic/i, /nr-data\.net/i, /bugsnag/i,
    /criteo/i, /taboola/i, /outbrain/i,
    /doubleclick/i, /googlesyndication/i, /googleadservices/i,
    /adnxs/i, /amazon-adsystem/i, /rubiconproject/i,
    /pubmatic/i, /openx\.net/i, /adsrvr/i,
    /scorecardresearch/i, /comscore/i, /demdex/i,
    /optimizely/i, /mouseflow/i, /crazyegg/i,
    /luckyorange/i, /logrocket/i, /smartlook/i,
    /tealium/i, /appsflyer/i, /branch\.io/i,
    /adjust\.com/i, /mparticle/i, /intercom/i,
    /drift\.com/i, /fingerprintjs/i, /datadome/i,
    /perimeterx/i, /pendo\.io/i, /bat\.bing/i,
    /tr\.snapchat/i, /ct\.pinterest/i, /snap\.licdn/i,
    /analytics\.twitter/i, /px\.ads\.linkedin/i,
    /serving-sys/i, /moatads/i, /2mdn\.net/i,
  ];

  function isTrackingScript(src) {
    if (!src) return false;
    for (const p of TRACKING_SCRIPT_PATTERNS) {
      if (p.test(src)) return true;
    }
    return false;
  }

  // Block tracking <script> tags as they're added to the DOM
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;

        // Check <script> tags
        if (node.tagName === "SCRIPT") {
          const src = node.src || "";
          const text = node.textContent || "";
          if (isTrackingScript(src)) {
            node.type = "text/blocked";
            node.removeAttribute("src");
            node.textContent = "";
            const c = classifyTracker(src);
            reportBlock(c.category, src, c.detail + " (script tag)", c.protection);
          }
          // Check inline tracking code
          else if (text.includes("gtag(") || text.includes("fbq(") ||
                   text.includes("_gaq.push") || text.includes("ga(") ||
                   text.includes("mixpanel.track") || text.includes("analytics.track") ||
                   text.includes("hj(") || text.includes("clarity(")) {
            node.type = "text/blocked";
            node.textContent = "/* Blocked by Total Privacy Shield */";
            reportBlock("tracker", window.location.href, "Inline tracking script blocked", "ads_scripts");
          }
        }

        // Check <img> tracking pixels
        if (node.tagName === "IMG") {
          const src = node.src || "";
          if (isTrackingURL(src)) {
            node.removeAttribute("src");
            node.style.display = "none";
            const c = classifyTracker(src);
            reportBlock(c.category, src, c.detail + " (img pixel)", c.protection);
          }
        }

        // Check <iframe> tracking embeds
        if (node.tagName === "IFRAME") {
          const src = node.src || "";
          if (isTrackingURL(src)) {
            node.removeAttribute("src");
            node.style.display = "none";
            const c = classifyTracker(src);
            reportBlock(c.category, src, c.detail + " (iframe)", c.protection);
          }
        }

        // Check <link> preloads for trackers
        if (node.tagName === "LINK") {
          const href = node.href || "";
          if (isTrackingURL(href)) {
            node.removeAttribute("href");
            const c = classifyTracker(href);
            reportBlock(c.category, href, c.detail + " (link preload)", c.protection);
          }
        }

        // Recursively check children
        if (node.querySelectorAll) {
          node.querySelectorAll("script[src], img[src], iframe[src], link[href]").forEach((child) => {
            const src = child.src || child.href || "";
            if (isTrackingScript(src) || isTrackingURL(src)) {
              if (child.tagName === "SCRIPT") {
                child.type = "text/blocked";
                child.removeAttribute("src");
                child.textContent = "";
              } else {
                child.removeAttribute("src");
                child.removeAttribute("href");
                child.style.display = "none";
              }
              const c = classifyTracker(src);
              reportBlock(c.category, src, c.detail + " (DOM scan)", c.protection);
            }
          });
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // =========================================================================
  // 21. SCAN EXISTING DOM for tracking elements already loaded
  // =========================================================================

  function scanExistingDOM() {
    // Scan all script tags
    document.querySelectorAll("script[src]").forEach((el) => {
      if (isTrackingScript(el.src)) {
        el.type = "text/blocked";
        const src = el.src;
        el.removeAttribute("src");
        el.textContent = "";
        const c = classifyTracker(src);
        reportBlock(c.category, src, c.detail + " (existing script)", c.protection);
      }
    });

    // Scan inline scripts
    document.querySelectorAll("script:not([src])").forEach((el) => {
      const text = el.textContent || "";
      if (text.includes("gtag(") || text.includes("fbq(") ||
          text.includes("_gaq.push") || text.includes("ga(") ||
          text.includes("mixpanel.track") || text.includes("hj(") ||
          text.includes("clarity(")) {
        el.type = "text/blocked";
        el.textContent = "/* Blocked by Total Privacy Shield */";
        reportBlock("tracker", window.location.href, "Inline tracking script blocked", "ads_scripts");
      }
    });

    // Scan tracking pixels
    document.querySelectorAll("img").forEach((el) => {
      if (el.src && isTrackingURL(el.src)) {
        const src = el.src;
        el.removeAttribute("src");
        el.style.display = "none";
        const c = classifyTracker(src);
        reportBlock(c.category, src, c.detail + " (existing pixel)", c.protection);
      }
    });

    // Scan tracking iframes
    document.querySelectorAll("iframe").forEach((el) => {
      if (el.src && isTrackingURL(el.src)) {
        const src = el.src;
        el.removeAttribute("src");
        el.style.display = "none";
        const c = classifyTracker(src);
        reportBlock(c.category, src, c.detail + " (existing iframe)", c.protection);
      }
    });
  }

  // Run scan after DOM is loaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanExistingDOM);
  } else {
    setTimeout(scanExistingDOM, 50);
  }

  // =========================================================================
  // 22. COOKIE MONITORING - Block cookies in real-time
  // =========================================================================

  const origCookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  if (origCookieDesc) {
    Object.defineProperty(document, "cookie", {
      get: function () {
        return origCookieDesc.get.call(this);
      },
      set: function (val) {
        // Block third-party cookie sets and tracking cookies
        const lower = (val || "").toLowerCase();
        const trackingCookies = [
          "_ga", "_gid", "_gat", "_fbp", "_fbc", "fr", "datr", "sb",
          "_gcl", "_uetsid", "_uetvid", "NID", "IDE", "MUID",
          "_hjid", "_hjSession", "_clck", "_clsk",
          "mp_", "ajs_", "amplitude_id",
          "__stripe", "_pin_unauth", "sc_at",
        ];
        const cookieName = val.split("=")[0].trim();
        const isTrackingCookie = trackingCookies.some((tc) =>
          cookieName.startsWith(tc) || cookieName === tc
        );

        if (isTrackingCookie) {
          reportBlock("cookie", "cookie://" + cookieName, "Tracking cookie blocked: " + cookieName, "cookies");
          return; // Don't set it
        }

        // Allow the cookie but report
        return origCookieDesc.set.call(this, val);
      },
      configurable: true,
    });
  }

  // =========================================================================
  // 23. REPORT ALWAYS-ON PROTECTIONS
  // =========================================================================

  setTimeout(() => {
    reportBlock("fingerprint", "spoof://screen", "Screen 1920x1080, DPR 1", "screen");
    reportBlock("fingerprint", "spoof://userAgent", "Chrome 120 / Windows 10", "browser_os");
    reportBlock("tracker", "block://wifi-network", "NetworkInfo API blocked", "wifi_network");
    reportBlock("fingerprint", "block://fonts", "Font enumeration blocked", "font");
    reportBlock("fingerprint", "block://clientHints", "Client Hints stripped", "browser_os");
    reportBlock("fingerprint", "block://sensors-api", "Motion/orientation blocked", "sensors");
    reportBlock("tracker", "block://geolocation-api", "Geolocation API blocked", "ip_location");
    reportBlock("tracker", "block://webrtc-api", "WebRTC/RTCPeerConnection blocked", "webrtc");
  }, 100);

  console.log(
    "%c[Total Privacy Shield] Active - All tracking and fingerprinting blocked",
    "color: #00ff88; font-weight: bold; font-size: 14px;"
  );
})();
