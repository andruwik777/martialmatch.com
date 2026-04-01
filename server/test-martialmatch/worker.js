/**
 * Cloudflare Worker — mode=test proxy.
 * Serves fixtures from repo:
 *   server/test-martialmatch/data/
 * Raw URLs (after push to default branch):
 *   https://raw.githubusercontent.com/andruwik777/martialmatch/master/server/test-martialmatch/data/...
 *
 * Regenerate fixtures: `python server/test-martialmatch/build_test_data.py`
 */
const REPO_RAW_BASE =
  "https://raw.githubusercontent.com/andruwik777/martialmatch/master/server/test-martialmatch/data";

/** numeric API id → folder name under data/ */
const NUMERIC_TO_SLUG = {
  628: "628-x-superpuchar-polski-bjj-nogi-gi",
  707: "707-puchar-polski-poludniowej-adcc",
  723: "723-grand-prix-polski-combat-ju-jutsu-",
  703: "703-puchar-polski-seniorow-juniorow-i-juniorow-mlodszych-w-grappling",
};

const ALLOWED_SLUGS = new Set(Object.values(NUMERIC_TO_SLUG));

function corsHeaders(origin, contentType) {
  var allowedOrigins = [
    "https://andruwik777.github.io",
    "http://localhost:8080",
  ];
  var allowOrigin = allowedOrigins.includes(origin) ? origin : null;
  var h = {
    "Content-Type": contentType,
    Vary: "Origin",
  };
  if (allowOrigin) {
    h["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return h;
}

/** Slug folder has no path separators */
function fixtureUrl(slugFolder, fileName) {
  return (
    REPO_RAW_BASE + "/" + encodeURIComponent(slugFolder) + "/" + encodeURIComponent(fileName)
  );
}

async function proxyFetch(targetUrl, origin, contentType) {
  try {
    var response = await fetch(targetUrl);
    if (!response.ok) {
      return new Response("Failed to fetch source: " + response.status, {
        status: 502,
        headers: corsHeaders(origin, contentType),
      });
    }
    var data = await response.text();
    return new Response(data, {
      status: 200,
      headers: corsHeaders(origin, contentType),
    });
  } catch (err) {
    return new Response("Proxy error: " + (err && err.message), {
      status: 500,
      headers: corsHeaders(origin, contentType),
    });
  }
}

export default {
  async fetch(request) {
    var origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      var oh = corsHeaders(origin, "text/plain");
      oh["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
      oh["Access-Control-Allow-Headers"] =
        request.headers.get("Access-Control-Request-Headers") || "Accept";
      oh["Access-Control-Max-Age"] = "86400";
      return new Response(null, { status: 204, headers: oh });
    }

    var url = new URL(request.url);
    var path = url.pathname;
    var contentType = "text/plain";
    var targetUrl = null;

    if (path === "/pl/events") {
      targetUrl = REPO_RAW_BASE + "/events.html";
      contentType = "text/html; charset=utf-8";
    } else if (path.startsWith("/pl/events/") && path.endsWith("/starting-lists")) {
      var segs = path.split("/").filter(Boolean);
      if (segs.length !== 4 || segs[0] !== "pl" || segs[1] !== "events") {
        return new Response("Not found", {
          status: 404,
          headers: corsHeaders(origin, contentType),
        });
      }
      var slug = decodeURIComponent(segs[2]);
      if (!ALLOWED_SLUGS.has(slug)) {
        return new Response("Not found", {
          status: 404,
          headers: corsHeaders(origin, contentType),
        });
      }
      targetUrl = fixtureUrl(slug, "starting-lists.html");
      contentType = "text/html; charset=utf-8";
    } else if (
      /^\/api\/public\/events\/\d+\/fights$/.test(path)
    ) {
      var fightParts = path.split("/").filter(Boolean);
      var fightId = fightParts[3];
      var slugF = NUMERIC_TO_SLUG[fightId];
      if (!slugF) {
        return new Response("Not found", {
          status: 404,
          headers: corsHeaders(origin, contentType),
        });
      }
      targetUrl = fixtureUrl(slugF, "fights.json");
      contentType = "application/json; charset=utf-8";
    } else if (/^\/api\/events\/\d+\/schedules$/.test(path)) {
      var schParts = path.split("/").filter(Boolean);
      var schId = schParts[2];
      var slugS = NUMERIC_TO_SLUG[schId];
      if (!slugS) {
        return new Response("Not found", {
          status: 404,
          headers: corsHeaders(origin, contentType),
        });
      }
      targetUrl = fixtureUrl(slugS, "schedules.json");
      contentType = "application/json; charset=utf-8";
    } else {
      return new Response("Not found", {
        status: 404,
        headers: corsHeaders(origin, contentType),
      });
    }

    return proxyFetch(targetUrl, origin, contentType);
  },
};
