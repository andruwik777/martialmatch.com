/**
 * QR-code fullscreen dialog — fully isolated from current-matches.js.
 * Loads qrcode-generator.js only when the user opens the dialog.
 */
(function () {
  "use strict";

  var qrNavBtn = document.getElementById("mm-cm-nav-qr");
  var qrRootEl = document.getElementById("mm-cm-qr-root");
  var qrCloseBtn = document.getElementById("mm-cm-qr-close");
  var qrTitleEl = document.getElementById("mm-cm-qr-title");
  var qrLeadEl = document.getElementById("mm-cm-qr-lead");
  var qrNoticeEl = document.getElementById("mm-cm-qr-notice");
  var qrCanvasEl = document.getElementById("mm-cm-qr-canvas");
  var qrErrorEl = document.getElementById("mm-cm-qr-error");

  if (!qrNavBtn || !qrRootEl) return;

  var MAX_QR_URL_LENGTH = 1500;
  var QR_TITLE_DEFAULT = "Scan this page";
  var QR_TITLE_FALLBACK = "Scan app link";
  var QR_LEAD_DEFAULT =
    "Opens the same view — tab, event, and URL filters included.";
  var QR_NOTICE_FALLBACK =
    "Your current filter is too complex for a QR code. Scan this link to open the app, then set your filter again.";

  var libLoadPromise = null;

  function appBaseUrl() {
    return new URL("/pl/events/", window.location.origin).href;
  }

  function resolveQrTarget() {
    var pageUrl = window.location.href;
    if (pageUrl.length <= MAX_QR_URL_LENGTH) {
      return { url: pageUrl, useFallback: false };
    }
    return { url: appBaseUrl(), useFallback: true };
  }

  function setQrCopy(useFallback) {
    if (qrTitleEl) {
      qrTitleEl.textContent = useFallback ? QR_TITLE_FALLBACK : QR_TITLE_DEFAULT;
    }
    if (qrLeadEl) {
      qrLeadEl.textContent = QR_LEAD_DEFAULT;
      qrLeadEl.classList.toggle("is-hidden", useFallback);
    }
    if (qrNoticeEl) {
      qrNoticeEl.textContent = useFallback ? QR_NOTICE_FALLBACK : "";
      qrNoticeEl.classList.toggle("is-hidden", !useFallback);
    }
  }

  function libScriptUrl() {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute("src") || "";
      if (src.indexOf("qr-overlay.js") === -1) continue;
      return new URL("qrcode-generator.js", new URL(src, window.location.href)).href;
    }
    return new URL("qrcode-generator.js", window.location.href).href;
  }

  function ensureLibLoaded() {
    if (typeof qrcode === "function") {
      return Promise.resolve();
    }
    if (libLoadPromise) return libLoadPromise;
    libLoadPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = libScriptUrl();
      script.onload = function () {
        if (typeof qrcode === "function") resolve();
        else reject(new Error("qrcode_lib_missing"));
      };
      script.onerror = function () {
        reject(new Error("qrcode_lib_load_failed"));
      };
      document.head.appendChild(script);
    });
    return libLoadPromise;
  }

  function showQrError(message) {
    if (!qrCanvasEl || !qrErrorEl) return;
    qrCanvasEl.classList.add("is-hidden");
    qrCanvasEl.setAttribute("aria-hidden", "true");
    qrErrorEl.textContent = message;
    qrErrorEl.classList.remove("is-hidden");
  }

  function drawQrOnCanvas(url, canvas) {
    if (!canvas || typeof qrcode !== "function") {
      throw new Error("qr_unavailable");
    }
    var qr = qrcode(0, "L");
    qr.addData(url);
    qr.make();
    var size = qr.getModuleCount();
    var border = 4;
    var moduleCount = size + border * 2;
    var maxCssPx = Math.min(
      window.innerWidth * 0.85,
      Math.min(window.innerHeight * 0.55, 288)
    );
    var scale = Math.max(1, Math.floor(maxCssPx / moduleCount));
    var width = moduleCount * scale;
    canvas.width = width;
    canvas.height = width;
    canvas.style.width = width + "px";
    canvas.style.height = width + "px";
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_context");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, width);
    ctx.fillStyle = "#000000";
    for (var row = 0; row < size; row++) {
      for (var col = 0; col < size; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(
            (col + border) * scale,
            (row + border) * scale,
            scale,
            scale
          );
        }
      }
    }
  }

  function renderQrContent() {
    if (!qrCanvasEl || !qrErrorEl) return;
    var target = resolveQrTarget();
    setQrCopy(target.useFallback);
    qrErrorEl.textContent = "";
    qrErrorEl.classList.add("is-hidden");
    qrCanvasEl.classList.remove("is-hidden");
    qrCanvasEl.removeAttribute("aria-hidden");
    ensureLibLoaded()
      .then(function () {
        try {
          drawQrOnCanvas(target.url, qrCanvasEl);
        } catch (err) {
          showQrError(
            "Could not generate QR code for this link — it may be too long."
          );
        }
      })
      .catch(function () {
        showQrError(
          "Could not load QR generator — check your connection and try again."
        );
      });
  }

  function openQrOverlay() {
    renderQrContent();
    qrRootEl.classList.remove("is-hidden");
    qrRootEl.setAttribute("aria-hidden", "false");
    document.body.classList.add("mm-cm-help-open");
    qrNavBtn.setAttribute("aria-expanded", "true");
    if (qrCloseBtn) qrCloseBtn.focus();
  }

  function closeQrOverlay() {
    qrRootEl.classList.add("is-hidden");
    qrRootEl.setAttribute("aria-hidden", "true");
    document.body.classList.remove("mm-cm-help-open");
    qrNavBtn.setAttribute("aria-expanded", "false");
    qrNavBtn.focus();
  }

  qrNavBtn.setAttribute("aria-expanded", "false");
  qrNavBtn.addEventListener("click", function () {
    if (qrRootEl.classList.contains("is-hidden")) openQrOverlay();
    else closeQrOverlay();
  });
  if (qrCloseBtn) {
    qrCloseBtn.addEventListener("click", closeQrOverlay);
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    if (!qrRootEl.classList.contains("is-hidden")) {
      ev.preventDefault();
      closeQrOverlay();
    }
  });
})();
