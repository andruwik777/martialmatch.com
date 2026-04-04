/** Edge cache TTL for cached proxy routes (seconds). */
const EDGE_CACHE_MAX_AGE = 3600;
/** Same TTL for browser HTTP cache on client responses (HIT/MISS 200). */
const BROWSER_CACHE_CONTROL = "public, max-age=" + EDGE_CACHE_MAX_AGE;

function corsHeaders(allowOrigin, extra) {
  const h = Object.assign({ Vary: "Origin" }, extra || {});
  if (allowOrigin) {
    h["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return h;
}

/**
 * GET only. Cache API stores body + Cache-Control; CORS + X-Cache + browser Cache-Control on 200.
 * @param {string} contentType e.g. text/html or application/json
 */
async function fetchWithEdgeCache(request, targetUrl, allowOrigin, contentType) {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders(allowOrigin, { "Content-Type": "text/plain" }),
    });
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.text();
    return new Response(body, {
      status: 200,
      headers: corsHeaders(allowOrigin, {
        "Content-Type": contentType,
        "X-Cache": "HIT",
        "Cache-Control": BROWSER_CACHE_CONTROL,
      }),
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
    headers: corsHeaders(allowOrigin, {
      "Content-Type": contentType,
      "X-Cache": "MISS",
      "Cache-Control": BROWSER_CACHE_CONTROL,
    }),
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

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin");

    const allowedOrigins = [
      "https://andruwik777.github.io",
      "http://localhost:8080",
    ];

    const allowOrigin = allowedOrigins.includes(origin) ? origin : null;

    const url = new URL(request.url);

    const path = url.pathname;

    const html = "text/html; charset=utf-8";
    const json = "application/json";

    // /pl/events — Cache API + X-Cache
    if (path === "/pl/events") {
      return tryCachedRoute(
        request,
        "https://martialmatch.com/pl/events",
        allowOrigin,
        html
      );
    }

    // pl/events/{slug}/starting-lists — Cache API + X-Cache
    if (path.startsWith("/pl/events/") && path.endsWith("/starting-lists")) {
      const id = path.split("/")[3];
      return tryCachedRoute(
        request,
        `https://martialmatch.com/pl/events/${id}/starting-lists`,
        allowOrigin,
        html
      );
    }

    let targetUrl;
    let contentType = "text/plain";

    // /api/public/events/628/fights — no edge cache (live data)
    if (path.startsWith("/api/public/events/") && path.endsWith("/fights")) {
      const id = path.split("/")[4];
      targetUrl = `https://martialmatch.com/api/public/events/${id}/fights`;
      contentType = json;
    }

    // /api/events/723/schedules — Cache API + X-Cache
    else if (path.startsWith("/api/events/") && path.endsWith("/schedules")) {
      const id = path.split("/")[3];
      return tryCachedRoute(
        request,
        `https://martialmatch.com/api/events/${id}/schedules`,
        allowOrigin,
        json
      );
    }

    else {
      return new Response("Not Found", {
        status: 404,
        headers: corsHeaders(allowOrigin, { "Content-Type": contentType }),
      });
    }

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
        headers: corsHeaders(allowOrigin, { "Content-Type": contentType }),
      });
    } catch (err) {
      return new Response("Proxy error", {
        status: 500,
        headers: corsHeaders(allowOrigin, { "Content-Type": contentType }),
      });
    }
  },
};
