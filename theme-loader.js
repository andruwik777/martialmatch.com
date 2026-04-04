/**
 * Theme: if prod.css exists at site root → app.css + prod.css.
 * Otherwise → app.css + dev.css, and if URL has mode=test also dev-test.css.
 * Favicon: HTML defaults to prod (favicon.svg); this script swaps on dev / dev-test.
 * Commit prod.css only on the production repo (not in dev).
 */
(function () {
  var sc = document.currentScript;
  if (!sc || !sc.src) return;
  var m = sc.src.match(/^(.*\/)[^/]+$/);
  if (!m) return;
  var base = m[1];

  function addCss(fileName) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = base + fileName;
    document.head.appendChild(link);
  }

  function setFavicon(fileName) {
    var href = base + fileName;
    var link =
      document.querySelector('link[rel="icon"][type="image/svg+xml"]') ||
      document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.type = "image/svg+xml";
      document.head.appendChild(link);
    }
    link.type = "image/svg+xml";
    link.href = href;
  }

  var testMode = /[?&]mode=test(?:&|$|#)/i.test(window.location.href);

  fetch(base + "prod.css", { method: "HEAD", cache: "no-cache" })
    .then(function (res) {
      if (res.ok) {
        addCss("prod.css");
      } else {
        addCss("dev.css");
        if (testMode) {
          addCss("dev-test.css");
          setFavicon("favicon-dev-test.svg");
        } else {
          setFavicon("favicon-dev.svg");
        }
      }
    })
    .catch(function () {
      addCss("dev.css");
      if (testMode) {
        addCss("dev-test.css");
        setFavicon("favicon-dev-test.svg");
      } else {
        setFavicon("favicon-dev.svg");
      }
    });
})();
