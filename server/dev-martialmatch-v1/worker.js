/**
 * Use Worker Cache API (match/put) for cached routes. Set false to always hit origin (debug).
 */
const USE_SERVER_CACHE = true;

/**
 * When true, 200 responses from edge-cached routes include Cache-Control for the browser.
 */
const USE_CLIENT_CACHE = true;

/** Edge cache TTL for cached proxy routes (seconds). */
const EDGE_CACHE_MAX_AGE = 3600;
/** Same TTL for browser HTTP cache on client responses (HIT/MISS 200), when USE_CLIENT_CACHE. */
const BROWSER_CACHE_CONTROL = "public, max-age=" + EDGE_CACHE_MAX_AGE;

/**
 * Logical cache reset: non-empty value adds ?_wcb=… only to the Cache API key URL (origin fetch
 * URLs are unchanged). Default "" = same key as before (worker request URL only).
 */
const CACHE_KEY_BUMP = "";

/** Origins allowed for CORS (request Origin must match exactly). */
const ALLOWED_CORS_ORIGINS = [
  "https://andruwik777.github.io",
  "http://localhost:8080",
];

function corsHeaders(allowOrigin, extra) {
  const h = Object.assign({ Vary: "Origin" }, extra || {});
  if (allowOrigin) {
    h["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return h;
}

/** Request used only for caches.default match/put — never sent to martialmatch.com. */
function workerCacheKeyRequest(request) {
  const u = new URL(request.url);
  if (CACHE_KEY_BUMP) {
    u.searchParams.set("_wcb", CACHE_KEY_BUMP);
  }
  return new Request(u.toString(), { method: "GET" });
}

function okHeadersWithOptionalBrowserCache(allowOrigin, contentType, xCache) {
  const extra = {
    "Content-Type": contentType,
    "X-Cache": xCache,
  };
  if (USE_CLIENT_CACHE) {
    extra["Cache-Control"] = BROWSER_CACHE_CONTROL;
  }
  return corsHeaders(allowOrigin, extra);
}

/**
 * GET only. Optional Cache API; CORS + X-Cache + optional browser Cache-Control on 200.
 * @param {string} contentType e.g. text/html or application/json
 */
async function fetchWithEdgeCache(request, targetUrl, allowOrigin, contentType) {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders(allowOrigin, { "Content-Type": "text/plain" }),
    });
  }

  if (!USE_SERVER_CACHE) {
    const originResp = await fetch(targetUrl);
    if (!originResp.ok) {
      return new Response("Failed to fetch source", {
        status: 500,
        headers: corsHeaders(allowOrigin, { "Content-Type": contentType }),
      });
    }
    const data = await originResp.text();
    return new Response(data, {
      status: 200,
      headers: okHeadersWithOptionalBrowserCache(
        allowOrigin,
        contentType,
        "BYPASS"
      ),
    });
  }

  const cache = caches.default;
  const cacheKey = workerCacheKeyRequest(request);

  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.text();
    return new Response(body, {
      status: 200,
      headers: okHeadersWithOptionalBrowserCache(
        allowOrigin,
        contentType,
        "HIT"
      ),
    });
  }

  const originResp = await fetch(targetUrl);
  if (!originResp.ok) {
    return new Response("Failed to fetch source", {
      status: 500,
      headers: corsHeaders(allowOrigin, { "Content-Type": contentType }),
    });
  }

  const data = await originResp.text();

  const toCache = new Response(data, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=" + EDGE_CACHE_MAX_AGE,
    },
  });
  await cache.put(cacheKey, toCache.clone());

  return new Response(data, {
    status: 200,
    headers: okHeadersWithOptionalBrowserCache(
      allowOrigin,
      contentType,
      "MISS"
    ),
  });
}

async function tryCachedRoute(request, targetUrl, allowOrigin, contentType) {
  try {
    return await fetchWithEdgeCache(request, targetUrl, allowOrigin, contentType);
  } catch (err) {
    return new Response("Proxy error", {
      status: 500,
      headers: corsHeaders(allowOrigin, {
        "Content-Type": contentType,
        "X-Cache": "MISS",
      }),
    });
  }
}

/** Live JSON — no Worker cache, no browser cache (fights must stay fresh). */
async function fetchOriginPassthrough(targetUrl, allowOrigin, contentType) {
  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      return new Response("Failed to fetch source", {
        status: 500,
        headers: corsHeaders(allowOrigin, { "Content-Type": contentType }),
      });
    }
    const data = await response.text();
    return new Response(data, {
      status: 200,
      headers: corsHeaders(allowOrigin, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      }),
    });
  } catch (err) {
    return new Response("Proxy error", {
      status: 500,
      headers: corsHeaders(allowOrigin, { "Content-Type": contentType }),
    });
  }
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin");

    const allowOrigin = ALLOWED_CORS_ORIGINS.includes(origin) ? origin : null;

    const url = new URL(request.url);
    const path = url.pathname;

    const html = "text/html; charset=utf-8";
    const json = "application/json";

    if (path === "/pl/events") {
      return tryCachedRoute(
        request,
        "https://martialmatch.com/pl/events",
        allowOrigin,
        html
      );
    }

    if (path.startsWith("/pl/events/") && path.endsWith("/starting-lists")) {
      const id = path.split("/")[3];
      return tryCachedRoute(
        request,
        `https://martialmatch.com/pl/events/${id}/starting-lists`,
        allowOrigin,
        html
      );
    }

    if (path.startsWith("/api/events/") && path.endsWith("/schedules")) {
      const id = path.split("/")[3];
      return tryCachedRoute(
        request,
        `https://martialmatch.com/api/events/${id}/schedules`,
        allowOrigin,
        json
      );
    }

    if (path.startsWith("/api/public/events/") && path.endsWith("/fights")) {
      const id = path.split("/")[4];
      return fetchOriginPassthrough(
        `https://martialmatch.com/api/public/events/${id}/fights`,
        allowOrigin,
        json
      );
    }

    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders(allowOrigin, { "Content-Type": "text/plain" }),
    });
  },
};
