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
  event.respondWith(fetch(event.request));
});
