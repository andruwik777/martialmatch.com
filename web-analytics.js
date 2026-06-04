/**
 * Cloudflare Web Analytics — production only (prod.css probe, same as theme-loader.js).
 * Dev / dev-test GitHub Pages never send pageviews.
 */
(function () {
  "use strict";

  var CF_WEB_ANALYTICS_TOKEN = "3ac62c8b088e4b4c96c1ca6bc4d04bfe";

  function repoBasePath() {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute("src") || "";
      if (src.indexOf("web-analytics.js") === -1) continue;
      var url = new URL(src, window.location.href);
      var path = url.pathname;
      var idx = path.lastIndexOf("/");
      return idx >= 0 ? path.slice(0, idx + 1) : "/";
    }
    return "/";
  }

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

  var base = repoBasePath();

  fetch(base + "prod.css", { method: "HEAD", cache: "no-cache" })
    .then(function (res) {
      if (res.ok) injectBeacon();
    })
    .catch(function () {
      /* dev / network error — no analytics */
    });
})();
