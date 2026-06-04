/**
 * PWA: pass-through service worker registration + custom Install affordance.
 * No caching; live fights.json / WebSocket behavior unchanged.
 */
(function (global) {
  "use strict";

  var SESSION_HIDE_KEY = "mm_pwa_install_hidden";

  var deferredPrompt = null;
  var installBtn = null;
  var sessionStartTab = null;

  function repoBasePath() {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute("src") || "";
      if (src.indexOf("pwa.js") === -1) continue;
      var url = new URL(src, global.location.href);
      var path = url.pathname;
      var idx = path.lastIndexOf("/");
      return idx >= 0 ? path.slice(0, idx + 1) : "/";
    }
    var m = global.location.pathname.match(/^(.*\/)(?:pl\/events\/current-matches\/|$)/);
    if (m && m[1]) return m[1];
    return "/";
  }

  function absoluteFromRepo(rel) {
    var base = repoBasePath();
    var clean = String(rel || "").replace(/^\//, "");
    return base + clean;
  }

  function isStandaloneDisplay() {
    if (global.matchMedia) {
      if (global.matchMedia("(display-mode: standalone)").matches) return true;
      if (global.matchMedia("(display-mode: fullscreen)").matches) return true;
    }
    return Boolean(global.navigator && global.navigator.standalone);
  }

  function isHiddenForSession() {
    try {
      return global.sessionStorage.getItem(SESSION_HIDE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function hideForSession() {
    try {
      global.sessionStorage.setItem(SESSION_HIDE_KEY, "1");
    } catch (e) {
      /* ignore */
    }
    hideInstallButton();
  }

  function tabFromUrl() {
    var p = new URLSearchParams(global.location.search || "");
    var raw = (p.get("tab") || "").toLowerCase();
    if (raw === "harmonogram") return "harmonogram";
    if (raw === "events") return "events";
    if (raw === "fights") return "fights";
    return "events";
  }

  function hideInstallButton() {
    if (installBtn) installBtn.hidden = true;
  }

  function showInstallButtonIfAllowed() {
    if (!installBtn || !deferredPrompt) return;
    if (isStandaloneDisplay() || isHiddenForSession()) {
      hideInstallButton();
      return;
    }
    installBtn.hidden = false;
    scheduleRepositionInstallButton();
  }

  function isVisibleEl(el) {
    if (!el || el.hidden) return false;
    if (el.classList && el.classList.contains("is-hidden")) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /** Vertical anchor: middle of active-event header card, else below nav. */
  function installAnchorRect() {
    var wrap = document.getElementById("mm-cm-header-card-wrap");
    if (isVisibleEl(wrap)) {
      var row =
        wrap.querySelector(".mm-event-row--header-compact") ||
        wrap.querySelector(".mm-event-row");
      if (isVisibleEl(row)) return row.getBoundingClientRect();
      return wrap.getBoundingClientRect();
    }
    var nav = document.querySelector(".mm-cm-header-nav");
    if (isVisibleEl(nav)) return nav.getBoundingClientRect();
    return null;
  }

  function positionInstallButton() {
    if (!installBtn) return;
    var anchor = installAnchorRect();
    var btnH =
      installBtn.getBoundingClientRect().height ||
      installBtn.offsetHeight ||
      44;
    var topPx = 8;
    if (anchor && anchor.height > 0) {
      topPx = Math.round(anchor.top + anchor.height / 2 - btnH / 2);
    }
    topPx = Math.max(8, topPx);
    installBtn.style.top =
      "max(" + topPx + "px, calc(0.5rem + env(safe-area-inset-top, 0px)))";
  }

  function scheduleRepositionInstallButton() {
    global.requestAnimationFrame(function () {
      global.requestAnimationFrame(positionInstallButton);
    });
  }

  function buildInstallButton() {
    if (installBtn || !document.body) return;
    installBtn = document.createElement("button");
    installBtn.type = "button";
    installBtn.className = "mm-pwa-install";
    installBtn.hidden = true;
    installBtn.setAttribute("aria-label", "Install app for fullscreen mode");
    installBtn.textContent = "INSTALL";

    installBtn.addEventListener("click", function () {
      if (!deferredPrompt) return;
      if (
        global.MM_METRICS &&
        typeof global.MM_METRICS.track === "function"
      ) {
        global.MM_METRICS.track("pwa_install_click", {});
      }
      deferredPrompt.prompt();
      deferredPrompt.userChoice
        .then(function (choice) {
          if (choice && choice.outcome === "dismissed") {
            hideForSession();
          }
          deferredPrompt = null;
          hideInstallButton();
        })
        .catch(function () {
          hideInstallButton();
        });
    });

    document.body.appendChild(installBtn);
    global.addEventListener("resize", scheduleRepositionInstallButton);
    global.addEventListener("orientationchange", scheduleRepositionInstallButton);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in global.navigator)) return;
    var swUrl = absoluteFromRepo("sw.js");
    var scope = repoBasePath();
    global.navigator.serviceWorker
      .register(swUrl, { scope: scope })
      .catch(function (err) {
        console.warn("PWA service worker registration failed", err);
      });
  }

  function attachManifest(href) {
    if (!document.head) return;
    var existing = document.querySelector('link[rel="manifest"]');
    if (existing) {
      existing.setAttribute("href", href);
      return;
    }
    var link = document.createElement("link");
    link.rel = "manifest";
    link.href = href;
    document.head.appendChild(link);
  }

  /** Prod vs dev/test — same prod.css probe as theme-loader.js. */
  function linkManifestForEnv() {
    var testMode = /[?&]mode=test(?:&|$|#)/i.test(global.location.href);
    fetch(absoluteFromRepo("prod.css"), { method: "HEAD", cache: "no-cache" })
      .then(function (res) {
        if (res.ok) {
          attachManifest(absoluteFromRepo("manifest.webmanifest"));
        } else if (testMode) {
          attachManifest(absoluteFromRepo("manifest-dev-test.webmanifest"));
        } else {
          attachManifest(absoluteFromRepo("manifest-dev.webmanifest"));
        }
      })
      .catch(function () {
        if (testMode) {
          attachManifest(absoluteFromRepo("manifest-dev-test.webmanifest"));
        } else {
          attachManifest(absoluteFromRepo("manifest-dev.webmanifest"));
        }
      });
  }

  function onTabChanged(tab) {
    if (sessionStartTab == null) {
      sessionStartTab = tab;
      return;
    }
    if (tab !== sessionStartTab) {
      hideForSession();
    }
  }

  function initInstallUi() {
    if (isStandaloneDisplay()) return;

    sessionStartTab = tabFromUrl();
    buildInstallButton();

    global.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      showInstallButtonIfAllowed();
    });

    global.addEventListener("appinstalled", function () {
      deferredPrompt = null;
      hideInstallButton();
    });
  }

  global.MM_PWA = {
    notifyTabChange: onTabChanged,
    repositionInstallButton: scheduleRepositionInstallButton,
    repoBasePath: repoBasePath,
  };

  linkManifestForEnv();
  registerServiceWorker();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initInstallUi);
  } else {
    initInstallUi();
  }
})(typeof window !== "undefined" ? window : self);
