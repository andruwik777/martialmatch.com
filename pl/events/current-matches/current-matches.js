(function () {
  "use strict";

  var cfg = window.MM_CONFIG;
  if (!cfg) {
    console.error("MM_CONFIG missing; load config.js first");
    return;
  }

  var params = new URLSearchParams(window.location.search);
  var eventId = params.get("event");

  var proxyLabel = document.getElementById("mm-proxy-label");
  if (proxyLabel) {
    proxyLabel.textContent = cfg.mode + " → " + cfg.baseUrl;
  }

  var errEl = document.getElementById("mm-cm-error");
  var contentEl = document.getElementById("mm-cm-content");
  var placeholderEl = document.getElementById("mm-cm-placeholder");

  function showError(msg) {
    if (placeholderEl) placeholderEl.classList.add("is-hidden");
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove("is-hidden");
    }
  }

  function clearError() {
    if (errEl) {
      errEl.textContent = "";
      errEl.classList.add("is-hidden");
    }
  }

  if (!eventId || !/^\d+$/.test(eventId)) {
    if (placeholderEl) {
      placeholderEl.classList.add("is-hidden");
    }
    showError(
      "Brak parametru event w URL (np. ?event=628). Wybierz zawody z listy."
    );
    var p = document.createElement("p");
    p.className = "mm-muted";
    var a = document.createElement("a");
    a.className = "mm-nav-link";
    a.href = cfg.withModeQuery("../");
    a.textContent = "Przejdź do listy zawodów";
    p.appendChild(a);
    if (contentEl) contentEl.appendChild(p);
    return;
  }

  clearError();
  if (placeholderEl) {
    placeholderEl.textContent =
      "Zawody ID: " + eventId + " — tu w kolejnej iteracji pojawi się lista walk (fetch /api/public/events/…/fights).";
  }
})();
