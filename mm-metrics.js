/**
 * Prod-only custom metrics (prod.css probe). Sends to prod Worker /mm/metrics/collect.
 */
(function (global) {
  "use strict";

  var CLIENT_KEY = "mm_metrics_client_id";
  var SESSION_KEY = "mm_metrics_session_id";
  var SESSION_SENT_KEY = "mm_metrics_session_sent";
  var METRICS_VERSION = 1;

  var enabled = false;
  var clientId = null;
  var sessionId = null;

  function repoBasePath() {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute("src") || "";
      if (src.indexOf("mm-metrics.js") === -1) continue;
      var url = new URL(src, global.location.href);
      var path = url.pathname;
      var idx = path.lastIndexOf("/");
      return idx >= 0 ? path.slice(0, idx + 1) : "/";
    }
    return "/";
  }

  function isTestMode() {
    return /[?&]mode=test(?:&|$|#)/i.test(global.location.href);
  }

  function collectUrl() {
    var cfg = global.MM_CONFIG;
    if (!cfg || !cfg.baseUrl) return null;
    return String(cfg.baseUrl).replace(/\/$/, "") + "/mm/metrics/collect";
  }

  function ensureClientId() {
    try {
      var existing = global.localStorage.getItem(CLIENT_KEY);
      if (existing) return existing;
      var id =
        global.crypto && global.crypto.randomUUID
          ? global.crypto.randomUUID()
          : "c-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      global.localStorage.setItem(CLIENT_KEY, id);
      return id;
    } catch (e) {
      return "c-anon-" + Date.now().toString(36);
    }
  }

  function ensureSessionId() {
    try {
      var existing = global.sessionStorage.getItem(SESSION_KEY);
      if (existing) return existing;
      var id =
        global.crypto && global.crypto.randomUUID
          ? global.crypto.randomUUID()
          : "s-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      global.sessionStorage.setItem(SESSION_KEY, id);
      return id;
    } catch (e) {
      return "s-anon-" + Date.now().toString(36);
    }
  }

  function sendPayload(body) {
    var url = collectUrl();
    if (!url || !enabled) return;
    var json = JSON.stringify(body);
    try {
      if (global.navigator && global.navigator.sendBeacon) {
        var blob = new Blob([json], { type: "application/json" });
        if (global.navigator.sendBeacon(url, blob)) return;
      }
    } catch (e) {
      /* fall through */
    }
    try {
      global.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
        keepalive: true,
        mode: "cors",
        credentials: "omit",
      }).catch(function () {});
    } catch (e2) {
      /* ignore */
    }
  }

  function track(event, props) {
    if (!enabled || !clientId || !sessionId) return;
    sendPayload({
      v: METRICS_VERSION,
      event: event,
      client_id: clientId,
      session_id: sessionId,
      props: props || {},
    });
  }

  function sessionProps() {
    var standalone = false;
    try {
      if (global.matchMedia) {
        standalone =
          global.matchMedia("(display-mode: standalone)").matches ||
          global.matchMedia("(display-mode: fullscreen)").matches;
      }
      if (!standalone && global.navigator) {
        standalone = Boolean(global.navigator.standalone);
      }
    } catch (e) {
      /* ignore */
    }
    var tab = "events";
    try {
      var p = new URLSearchParams(global.location.search || "");
      tab = (p.get("tab") || "events").toLowerCase();
    } catch (e2) {
      /* ignore */
    }
    return { tab: tab, standalone: standalone };
  }

  function sendSessionStartOnce() {
    try {
      if (global.sessionStorage.getItem(SESSION_SENT_KEY) === "1") return;
      global.sessionStorage.setItem(SESSION_SENT_KEY, "1");
    } catch (e) {
      /* ignore */
    }
    track("session_start", sessionProps());
  }

  function wireShareButton() {
    var btn = document.getElementById("mm-cm-nav-share");
    if (!btn || btn.getAttribute("data-mm-metrics-share") === "1") return;
    btn.setAttribute("data-mm-metrics-share", "1");
    btn.addEventListener("click", function () {
      track("share_click", {});
    });
  }

  function initMetrics() {
    if (isTestMode()) return;
    enabled = true;
    clientId = ensureClientId();
    sessionId = ensureSessionId();
    sendSessionStartOnce();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", wireShareButton);
    } else {
      wireShareButton();
    }
  }

  global.MM_METRICS = { track: track };

  if (isTestMode()) return;

  fetch(repoBasePath() + "prod.css", { method: "HEAD", cache: "no-cache" })
    .then(function (res) {
      if (res.ok) initMetrics();
    })
    .catch(function () {
      /* dev — no metrics */
    });
})(typeof window !== "undefined" ? window : self);
