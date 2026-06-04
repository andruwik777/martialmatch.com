/**
 * Minimal service worker for PWA installability only.
 * Does not cache API, fights.json, or static assets — network behavior unchanged.
 */
"use strict";

self.addEventListener("install", function (event) {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  // Cross-origin (Worker API, /mm/metrics/collect): bypass SW — avoids CORS/beacon failures.
  if (url.origin !== self.location.origin) {
    return;
  }
  event.respondWith(fetch(request));
});
