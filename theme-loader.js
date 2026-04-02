/**
 * Theme: if prod.css exists at site root → app.css + prod.css.
 * Otherwise → app.css + dev.css, and if URL has mode=test also dev-test.css.
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

  var testMode = /[?&]mode=test(?:&|$|#)/i.test(window.location.href);

  fetch(base + "prod.css", { method: "HEAD", cache: "no-cache" })
    .then(function (res) {
      if (res.ok) {
        addCss("prod.css");
      } else {
        addCss("dev.css");
        if (testMode) addCss("dev-test.css");
      }
    })
    .catch(function () {
      addCss("dev.css");
      if (testMode) addCss("dev-test.css");
    });
})();
