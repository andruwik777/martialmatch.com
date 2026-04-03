/**
 * Proxy base: use ?mode=test in the page URL for TEST; otherwise PROD.
 * Internal links should go through MM_CONFIG.withModeQuery(href) when building in JS.
 * Static <a class="mm-nav-link" href="..."> are upgraded on DOMContentLoaded.
 */
(function (global) {
  "use strict";



  var BASE_BY_MODE = {
    prod: "https://martialmatch-v1.andruwik777.workers.dev",
    test: "https://martialmatch-v1.andruwik777.workers.dev",
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

  /** Odświeżanie listy walk na /pl/events/current-matches/ (tylko endpoint fights). */
  var CURRENT_MATCHES_REFRESH_MS = 30000;

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

  /**
   * Segment ścieżki MartialMatch: /pl/events/{slug}/…
   * Np. "628-x-superpuchar-polski-bjj-nogi-gi" → id liczbowe do API + reszta slug.
   * @param {string} raw wartość z query (może być już zdecodeowana przez przeglądarkę)
   * @returns {{ slug: string, numericId: string, tail: string } | null}
   */
  /**
   * Publiczny URL strony wydarzenia na martialmatch.com (nie proxy).
   * @param {string} slug np. "628-x-superpuchar-polski-bjj-nogi-gi"
   */
  function martialMatchEventUrl(slug) {
    if (slug == null || typeof slug !== "string") return "";
    var s = slug.trim();
    if (!s) return "";
    return (
      "https://martialmatch.com/pl/events/" + encodeURIComponent(s)
    );
  }

  function parseEventSlug(raw) {
    if (raw == null || typeof raw !== "string") return null;
    var s = raw.trim();
    try {
      s = decodeURIComponent(s);
    } catch (e) {
      return null;
    }
    s = s.trim();
    if (!s) return null;
    var m = s.match(/^(\d+)-(.+)$/);
    if (!m) return null;
    var tail = m[2];
    if (!tail) return null;
    return { slug: s, numericId: m[1], tail: tail };
  }

  global.MM_CONFIG = {
    mode: mode,
    baseUrl: baseUrl,
    isTestMode: isTest,
    withModeQuery: withModeQuery,
    currentMatchesRefreshMs: CURRENT_MATCHES_REFRESH_MS,
    /** Absolute URL for a path on the proxied origin, e.g. "/pl/events" */
    url: function (path) {
      var p = path.charAt(0) === "/" ? path : "/" + path;
      return baseUrl + p;
    },
    parseEventSlug: parseEventSlug,
    martialMatchEventUrl: martialMatchEventUrl,
  };

  function shouldAppendModeToHref(href) {
    if (!href) return false;
    var h = href.trim();
    if (/^(?:https?:|mailto:|tel:)/i.test(h)) return false;
    return true;
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", function () {
      document.querySelectorAll("a.mm-nav-link[href]").forEach(function (a) {
        var h = a.getAttribute("href");
        if (h && shouldAppendModeToHref(h)) {
          a.href = withModeQuery(h);
        }
      });
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
