/**
 * Theme: if prod.css exists at site root → app.css + prod.css.
 * Otherwise → app.css + dev.css, and if URL has mode=test also dev-test.css.
 * Favicon / apple-touch-icon: optimistic dev swap (reverted when prod.css exists).
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

  function setAppleTouchIcon(fileName) {
    var href = base + fileName;
    var link = document.querySelector('link[rel="apple-touch-icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "apple-touch-icon";
      document.head.appendChild(link);
    }
    link.href = href;
  }

  var testMode = /[?&]mode=test(?:&|$|#)/i.test(window.location.href);
  var devFavicon = testMode ? "favicon-dev-test.svg" : "favicon-dev.svg";
  var devTouchIcon = testMode ? "icons/icon-192-dev-test.png" : "icons/icon-192-dev.png";

  setFavicon(devFavicon);
  setAppleTouchIcon(devTouchIcon);

  function applyDevTheme() {
    addCss("dev.css");
    if (testMode) addCss("dev-test.css");
  }

  function applyProdTheme() {
    addCss("prod.css");
    setFavicon("favicon.svg");
    setAppleTouchIcon("icons/icon-192.png");
  }

  fetch(base + "prod.css", { method: "HEAD", cache: "no-cache" })
    .then(function (res) {
      if (res.ok) {
        applyProdTheme();
      } else {
        applyDevTheme();
      }
    })
    .catch(function () {
      applyDevTheme();
    });
})();
