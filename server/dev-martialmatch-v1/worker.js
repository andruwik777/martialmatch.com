/** Edge cache TTL for HTML starting-lists (seconds). */
const STARTING_LISTS_CACHE_MAX_AGE = 3600;

function corsHeaders(allowOrigin, extra) {
  const h = Object.assign({ Vary: "Origin" }, extra || {});
  if (allowOrigin) {
    h["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return h;
}

/**
 * GET only. Cache API stores body + Cache-Control; CORS + X-Cache on each client response.
 */
async function fetchStartingListsWithCache(request, targetUrl, allowOrigin) {
  const contentType = "text/html; charset=utf-8";
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
      "Cache-Control": "public, max-age=" + STARTING_LISTS_CACHE_MAX_AGE,
    },
  });
  await cache.put(cacheKey, toCache.clone());

  return new Response(data, {
    status: 200,
    headers: corsHeaders(allowOrigin, {
      "Content-Type": contentType,
      "X-Cache": "MISS",
    }),
  });
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

    let targetUrl;
    let contentType = "text/plain";

    if (path === "/pl/events") {
      targetUrl = "https://martialmatch.com/pl/events";
      contentType = "text/html; charset=utf-8";
    }

    // pl/events/{slug}/starting-lists — Cache API + X-Cache
    else if (path.startsWith("/pl/events/") && path.endsWith("/starting-lists")) {
      const id = path.split("/")[3];
      targetUrl = `https://martialmatch.com/pl/events/${id}/starting-lists`;
      try {
        return await fetchStartingListsWithCache(request, targetUrl, allowOrigin);
      } catch (err) {
        return new Response("Proxy error", {
          status: 500,
          headers: corsHeaders(allowOrigin, {
            "Content-Type": "text/html; charset=utf-8",
            "X-Cache": "MISS",
          }),
        });
      }
    }

    // /api/public/events/628/fights
    else if (path.startsWith("/api/public/events/") && path.endsWith("/fights")) {
      const id = path.split("/")[4];
      targetUrl = `https://martialmatch.com/api/public/events/${id}/fights`;
      contentType = "application/json";
    }

    // /api/events/723/schedules
    else if (path.startsWith("/api/events/") && path.endsWith("/schedules")) {
      const id = path.split("/")[3];
      targetUrl = `https://martialmatch.com/api/events/${id}/schedules`;
      contentType = "application/json";
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
