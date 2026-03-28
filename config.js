/**
 * Switch mode here for local / deploy testing.
 * Both HTML and JSON are fetched via the same proxy base (CORS).
 */
(function (global) {
  "use strict";

  var MODE = "prod";

  var BASE_BY_MODE = {
    prod: "https://martialmatch.andruwik777.workers.dev",
    test: "https://test-martialmatch.andruwik777.workers.dev",
  };

  var baseUrl = BASE_BY_MODE[MODE] || BASE_BY_MODE.prod;

  global.MM_CONFIG = {
    mode: MODE,
    baseUrl: baseUrl,
    /** Absolute URL for a path on the proxied origin, e.g. "/pl/events" */
    url: function (path) {
      var p = path.charAt(0) === "/" ? path : "/" + path;
      return baseUrl + p;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
