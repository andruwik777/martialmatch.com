/**
 * Proxy base: use ?mode=test in the page URL for TEST; otherwise PROD.
 * Internal links should go through MM_CONFIG.withModeQuery(href) when building in JS.
 * Static <a class="mm-nav-link" href="..."> are upgraded on DOMContentLoaded.
 */
(function (global) {
  "use strict";

  var BASE_BY_MODE = {
    prod: "https://martialmatch.andruwik777.workers.dev",
    test: "https://test-martialmatch.andruwik777.workers.dev",
  };

  var loc = global.location;
  var pageParams =
    loc && typeof URLSearchParams !== "undefined"
      ? new URLSearchParams(loc.search || "")
      : null;
  var modeParam = pageParams ? pageParams.get("mode") : null;
  var isTest =
    modeParam !== null && String(modeParam).toLowerCase() === "test";
  var mode = isTest ? "test" : "prod";
  var baseUrl = BASE_BY_MODE[mode] || BASE_BY_MODE.prod;

  /**
   * @param {string} href relative or absolute href without mode=test
   * @returns {string}
   */
  function withModeQuery(href) {
    if (!isTest || !href) return href;
    if (/[?&]mode=test(?:&|$|#)/i.test(href)) return href;
    var hashStart = href.indexOf("#");
    var hash = hashStart >= 0 ? href.slice(hashStart) : "";
    var path = hashStart >= 0 ? href.slice(0, hashStart) : href;
    var sep = path.indexOf("?") >= 0 ? "&" : "?";
    return path + sep + "mode=test" + hash;
  }

  global.MM_CONFIG = {
    mode: mode,
    baseUrl: baseUrl,
    isTestMode: isTest,
    withModeQuery: withModeQuery,
    /** Absolute URL for a path on the proxied origin, e.g. "/pl/events" */
    url: function (path) {
      var p = path.charAt(0) === "/" ? path : "/" + path;
      return baseUrl + p;
    },
  };

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", function () {
      document.querySelectorAll("a.mm-nav-link[href]").forEach(function (a) {
        var h = a.getAttribute("href");
        if (h) a.href = withModeQuery(h);
      });
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
