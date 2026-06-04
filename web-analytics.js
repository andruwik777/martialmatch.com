/**
 * Cloudflare Web Analytics — production only (window.MM_PROD_PROBE from theme-loader.js).
 * Dev / dev-test GitHub Pages never send pageviews.
 */
(function () {
  "use strict";

  var CF_WEB_ANALYTICS_TOKEN = "3ac62c8b088e4b4c96c1ca6bc4d04bfe";

  function injectBeacon() {
    if (document.querySelector("script[data-cf-beacon]")) return;
    var script = document.createElement("script");
    script.defer = true;
    script.src = "https://static.cloudflareinsights.com/beacon.min.js";
    script.setAttribute(
      "data-cf-beacon",
      JSON.stringify({ token: CF_WEB_ANALYTICS_TOKEN })
    );
    document.head.appendChild(script);
  }

  function whenProdSite(cb) {
    var probe = window.MM_PROD_PROBE;
    if (!probe || typeof probe.then !== "function") {
      cb(false);
      return;
    }
    probe.then(cb).catch(function () {
      cb(false);
    });
  }

  whenProdSite(function (isProd) {
    if (isProd) injectBeacon();
  });
})();
