/**
 * Prod-only metrics dashboard: GET /mm/metrics/stats
 * Protect with Cloudflare Access (Google OAuth) — see METRICS-SETUP.md.
 */

import { KV_EVENT_PREFIX } from "./metrics-collect.js";

const STATS_PATH = "/mm/metrics/stats";

const KV_LABELS = {
  share_click: "Share click",
  qr_open: "QR open",
  help_open: "Help open",
  fights_refresh: "Fights refresh",
  home_nav: "Home nav",
  orig_mm_link: "Original MM link",
  pwa_install_click: "PWA install click",
  filter_open: "Filter panel open",
};

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function parseDayParam(raw) {
  if (!raw) return utcToday();
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function shiftDay(dayStr, deltaDays) {
  var d = new Date(dayStr + "T12:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statsUrl(day) {
  return STATS_PATH + "?day=" + encodeURIComponent(day);
}

async function readKvCounters(kv, day) {
  var rows = [];
  var events = Object.keys(KV_EVENT_PREFIX);
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    var prefix = KV_EVENT_PREFIX[event];
    var raw = await kv.get(prefix + day);
    var n = raw ? parseInt(raw, 10) : 0;
    if (!Number.isFinite(n) || n < 0) n = 0;
    rows.push({
      event: event,
      label: KV_LABELS[event] || event,
      count: n,
    });
  }
  return rows;
}

async function queryD1Grouped(db, sql, day) {
  var stmt = db.prepare(sql).bind(day);
  var result = await stmt.all();
  return result.results || [];
}

async function loadD1Stats(db, day) {
  var sessions = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM events WHERE day = ? AND event = 'session_start'"
    )
    .bind(day)
    .first();

  var uniqueClients = await db
    .prepare(
      "SELECT COUNT(DISTINCT client_id) AS n FROM events WHERE day = ?"
    )
    .bind(day)
    .first();

  var byEvent = await queryD1Grouped(
    db,
    "SELECT event, COUNT(*) AS n FROM events WHERE day = ? GROUP BY event ORDER BY n DESC",
    day
  );

  var tabViews = await queryD1Grouped(
    db,
    "SELECT json_extract(props, '$.tab') AS tab, COUNT(*) AS n FROM events WHERE day = ? AND event = 'tab_view' GROUP BY tab ORDER BY n DESC",
    day
  );

  var filterApply = await queryD1Grouped(
    db,
    "SELECT json_extract(props, '$.kind') AS kind, COUNT(*) AS n, ROUND(AVG(CAST(json_extract(props, '$.count') AS REAL)), 1) AS avg_count FROM events WHERE day = ? AND event = 'filter_apply' GROUP BY kind ORDER BY kind",
    day
  );

  var shareOutcome = await queryD1Grouped(
    db,
    "SELECT json_extract(props, '$.method') AS method, COUNT(*) AS n FROM events WHERE day = ? AND event = 'share_outcome' GROUP BY method ORDER BY n DESC",
    day
  );

  var favorites = await queryD1Grouped(
    db,
    "SELECT json_extract(props, '$.action') AS action, COUNT(*) AS n FROM events WHERE day = ? AND event = 'favorite_toggle' GROUP BY action ORDER BY action",
    day
  );

  return {
    sessions: sessions && sessions.n != null ? Number(sessions.n) : 0,
    uniqueClients:
      uniqueClients && uniqueClients.n != null ? Number(uniqueClients.n) : 0,
    byEvent: byEvent,
    tabViews: tabViews,
    filterApply: filterApply,
    shareOutcome: shareOutcome,
    favorites: favorites,
  };
}

function renderTable(headers, rows) {
  if (!rows.length) {
    return "<p class=\"muted\">No data.</p>";
  }
  var html = "<table><thead><tr>";
  for (var h = 0; h < headers.length; h++) {
    html += "<th>" + escapeHtml(headers[h]) + "</th>";
  }
  html += "</tr></thead><tbody>";
  for (var r = 0; r < rows.length; r++) {
    html += "<tr>";
    for (var c = 0; c < rows[r].length; c++) {
      html += "<td>" + escapeHtml(rows[r][c]) + "</td>";
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

function renderHtml(opts) {
  var day = opts.day;
  var today = opts.today;
  var kv = opts.kv;
  var d1 = opts.d1;
  var userEmail = opts.userEmail;
  var accessWarning = opts.accessWarning;

  var prevDay = shiftDay(day, -1);
  var nextDay = shiftDay(day, 1);
  var nav =
    "<nav class=\"day-nav\">" +
    "<a href=\"" +
    escapeHtml(statsUrl(prevDay)) +
    "\">← " +
    escapeHtml(prevDay) +
    "</a>";
  if (nextDay <= today) {
    nav +=
      " <a href=\"" +
      escapeHtml(statsUrl(nextDay)) +
      "\">" +
      escapeHtml(nextDay) +
      " →</a>";
  }
  nav += "</nav>";

  var kvRows = kv.map(function (row) {
    return [row.label, String(row.count)];
  });

  var d1EventRows = d1.byEvent.map(function (row) {
    return [String(row.event || ""), String(row.n != null ? row.n : 0)];
  });

  var tabRows = d1.tabViews.map(function (row) {
    return [String(row.tab || "(unknown)"), String(row.n != null ? row.n : 0)];
  });

  var filterRows = d1.filterApply.map(function (row) {
    return [
      String(row.kind || ""),
      String(row.n != null ? row.n : 0),
      String(row.avg_count != null ? row.avg_count : "—"),
    ];
  });

  var shareRows = d1.shareOutcome.map(function (row) {
    return [String(row.method || ""), String(row.n != null ? row.n : 0)];
  });

  var favRows = d1.favorites.map(function (row) {
    return [String(row.action || ""), String(row.n != null ? row.n : 0)];
  });

  var warnBlock = accessWarning
    ? "<p class=\"warn\">⚠ " +
      escapeHtml(accessWarning) +
      " Configure Cloudflare Access — see METRICS-SETUP.md.</p>"
    : "";

  var userLine = userEmail
    ? "<p class=\"muted\">Signed in via Access: " +
      escapeHtml(userEmail) +
      "</p>"
    : "";

  return (
    "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n" +
    "<meta charset=\"utf-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "<meta name=\"robots\" content=\"noindex,nofollow\">\n" +
    "<title>MM metrics — " +
    escapeHtml(day) +
    " (UTC)</title>\n" +
    "<style>\n" +
    "body{font-family:system-ui,-apple-system,sans-serif;margin:1rem 1.25rem;line-height:1.45;color:#1a1d26;background:#f4f5f8;}\n" +
    "h1{font-size:1.35rem;margin:0 0 .25rem;}\n" +
    "h2{font-size:1rem;margin:1.5rem 0 .5rem;}\n" +
    ".muted{color:#5c6370;font-size:.9rem;}\n" +
    ".warn{background:#fff3cd;border:1px solid #ffc107;padding:.6rem .75rem;border-radius:6px;font-size:.9rem;}\n" +
    ".summary{display:flex;flex-wrap:wrap;gap:.75rem;margin:1rem 0;}\n" +
    ".card{background:#fff;border:1px solid #d8dbe3;border-radius:8px;padding:.75rem 1rem;min-width:8rem;}\n" +
    ".card strong{display:block;font-size:1.4rem;}\n" +
    "table{border-collapse:collapse;width:100%;max-width:40rem;background:#fff;border:1px solid #d8dbe3;border-radius:8px;overflow:hidden;}\n" +
    "th,td{text-align:left;padding:.45rem .65rem;border-bottom:1px solid #e8eaef;font-size:.9rem;}\n" +
    "th{background:#eef0f5;font-weight:600;}\n" +
    "tr:last-child td{border-bottom:none;}\n" +
    ".day-nav a{margin-right:1rem;}\n" +
    "a{color:#2563eb;}\n" +
    "</style>\n</head>\n<body>\n" +
    "<h1>MartialMatch prod metrics</h1>\n" +
    "<p class=\"muted\">Day (UTC): <strong>" +
    escapeHtml(day) +
    "</strong></p>\n" +
    userLine +
    warnBlock +
    nav +
    "<div class=\"summary\">\n" +
    "<div class=\"card\"><span class=\"muted\">Sessions</span><strong>" +
    d1.sessions +
    "</strong></div>\n" +
    "<div class=\"card\"><span class=\"muted\">Unique clients</span><strong>" +
    d1.uniqueClients +
    "</strong></div>\n" +
    "</div>\n" +
    "<h2>KV daily counters</h2>\n" +
    renderTable(["Event", "Count"], kvRows) +
    "<h2>D1 — all events</h2>\n" +
    renderTable(["Event", "Count"], d1EventRows) +
    "<h2>Tab views</h2>\n" +
    renderTable(["Tab", "Count"], tabRows) +
    "<h2>Filter apply</h2>\n" +
    renderTable(["Kind", "Count", "Avg selected"], filterRows) +
    "<h2>Share outcome</h2>\n" +
    renderTable(["Method", "Count"], shareRows) +
    "<h2>Favorites</h2>\n" +
    renderTable(["Action", "Count"], favRows) +
    "<p class=\"muted\" style=\"margin-top:2rem\">Prod Worker only · aggregates, no PII · " +
    new Date().toISOString() +
    "</p>\n" +
    "</body>\n</html>"
  );
}

export function isMetricsStatsPath(pathname) {
  return pathname === STATS_PATH;
}

export async function handleMetricsStats(request, env, url) {
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { "Content-Type": "text/plain" },
    });
  }

  var day = parseDayParam(url.searchParams.get("day"));
  if (!day) {
    return new Response("Invalid day (use YYYY-MM-DD)", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }

  var today = utcToday();
  if (day > today) {
    return new Response("Day cannot be in the future", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }

  var kv = env.METRICS_KV;
  var db = env.METRICS_DB;
  if (!kv || !db) {
    return new Response("Metrics bindings missing", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }

  var userEmail =
    request.headers.get("Cf-Access-Authenticated-User-Email") ||
    request.headers.get("CF-Access-Authenticated-User-Email") ||
    "";

  var accessWarning = userEmail
    ? ""
    : "Request did not pass Cloudflare Access (no authenticated user header).";

  try {
    var kvStats = await readKvCounters(kv, day);
    var d1Stats = await loadD1Stats(db, day);
    var html = renderHtml({
      day: day,
      today: today,
      kv: kvStats,
      d1: d1Stats,
      userEmail: userEmail,
      accessWarning: accessWarning,
    });
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (err) {
    var msg = err && err.message ? err.message : "stats_failed";
    return new Response("Stats error: " + msg, {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
