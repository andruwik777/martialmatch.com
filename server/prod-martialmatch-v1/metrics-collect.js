/**
 * Prod-only custom metrics: POST /mm/metrics/collect
 * KV: share_click, qr_open, help_open, fights_refresh, home_nav, orig_mm_link,
 *     pwa_install_click, filter_open → daily counters
 * D1: session_start, tab_view, filter_apply, filter_clear, favorite_toggle,
 *     event_select, change_active_event, share_outcome → events table
 */

export const KV_EVENT_PREFIX = {
  share_click: "metrics:share:",
  qr_open: "metrics:qr:",
  help_open: "metrics:help:",
  fights_refresh: "metrics:fights_refresh:",
  home_nav: "metrics:home:",
  orig_mm_link: "metrics:orig_link:",
  pwa_install_click: "metrics:pwa_install:",
  filter_open: "metrics:filter_open:",
};

const METRICS_PATH = "/mm/metrics/collect";

const D1_EVENTS = new Set([
  "session_start",
  "tab_view",
  "filter_apply",
  "filter_clear",
  "favorite_toggle",
  "event_select",
  "change_active_event",
  "share_outcome",
]);

const ALLOWED_EVENTS = new Set([
  ...Object.keys(KV_EVENT_PREFIX),
  ...D1_EVENTS,
]);

const ALLOWED_TABS = new Set(["events", "fights", "harmonogram"]);
const ALLOWED_FILTER_KIND = new Set(["events", "slug"]);
const ALLOWED_FAVORITE_ACTION = new Set(["add", "remove"]);
const ALLOWED_SHARE_METHOD = new Set(["native", "clipboard", "abort"]);

const CLIENT_ERROR_CODES = new Set([
  "invalid_tab",
  "invalid_kind",
  "invalid_count",
  "invalid_action",
  "invalid_method",
  "invalid_has_slug",
  "invalid_has_filter",
]);

const METRICS_PAGES_ORIGIN = "https://andruwik777.github.io";
const DEV_PAGES_PATH = "/dev.martialmatch.com/";

let schemaReady = false;

function utcDay(isoTs) {
  return String(isoTs || new Date().toISOString()).slice(0, 10);
}

function jsonResponse(allowOrigin, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      Vary: "Origin",
      ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    },
  });
}

function isValidId(value) {
  if (typeof value !== "string") return false;
  var s = value.trim();
  return s.length >= 8 && s.length <= 64;
}

function isProdMetricsRequest(request) {
  var ref = request.headers.get("Referer") || "";
  if (!ref) return true;
  try {
    var u = new URL(ref);
    if (u.origin !== METRICS_PAGES_ORIGIN) return false;
    if (u.pathname.indexOf(DEV_PAGES_PATH) !== -1) return false;
    if (u.pathname.indexOf("/martialmatch.com/") !== -1) return true;
    if (u.pathname === "/" || u.pathname === "") return true;
    if (u.pathname.indexOf("/martialmatch/") === 0) return true;
    return false;
  } catch (e) {
    return false;
  }
}

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS clients (
        client_id TEXT PRIMARY KEY,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL
      )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        day TEXT NOT NULL,
        event TEXT NOT NULL,
        client_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        props TEXT
      )`
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_events_day_event ON events (day, event)"
    ),
  ]);
  schemaReady = true;
}

async function incrementKvCounter(kv, key) {
  var raw = await kv.get(key);
  var n = raw ? parseInt(raw, 10) : 0;
  if (!Number.isFinite(n) || n < 0) n = 0;
  await kv.put(key, String(n + 1));
}

async function insertEvent(db, ts, day, event, payload, props) {
  var propsJson =
    props && typeof props === "object" ? JSON.stringify(props) : null;
  await db
    .prepare(
      `INSERT INTO events (ts, day, event, client_id, session_id, props)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(ts, day, event, payload.client_id, payload.session_id, propsJson)
    .run();
}

function readTab(props) {
  return props && typeof props.tab === "string" ? props.tab : "";
}

function requireTab(props) {
  var tab = readTab(props);
  if (!ALLOWED_TABS.has(tab)) throw new Error("invalid_tab");
  return tab;
}

function requireBool(props, key) {
  var v = props && props[key];
  if (typeof v !== "boolean") throw new Error("invalid_" + key);
  return v;
}

function normalizeD1Props(event, rawProps) {
  var props =
    rawProps && typeof rawProps === "object" ? rawProps : {};

  if (event === "session_start") {
    return props;
  }

  if (event === "tab_view" || event === "change_active_event") {
    return { tab: requireTab(props) };
  }

  if (event === "event_select") {
    var fromTab =
      props && typeof props.from_tab === "string" ? props.from_tab : "";
    if (!ALLOWED_TABS.has(fromTab)) throw new Error("invalid_tab");
    return { from_tab: fromTab };
  }

  if (event === "filter_apply") {
    var kind =
      props && typeof props.kind === "string" ? props.kind : "";
    if (!ALLOWED_FILTER_KIND.has(kind)) throw new Error("invalid_kind");
    var count = props.count;
    if (
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      count < 0 ||
      count > 10000
    ) {
      throw new Error("invalid_count");
    }
    return {
      kind: kind,
      tab: requireTab(props),
      count: Math.floor(count),
    };
  }

  if (event === "filter_clear") {
    var clearKind =
      props && typeof props.kind === "string" ? props.kind : "";
    if (!ALLOWED_FILTER_KIND.has(clearKind)) throw new Error("invalid_kind");
    return {
      kind: clearKind,
      tab: requireTab(props),
    };
  }

  if (event === "favorite_toggle") {
    var action =
      props && typeof props.action === "string" ? props.action : "";
    if (!ALLOWED_FAVORITE_ACTION.has(action)) throw new Error("invalid_action");
    return { action: action };
  }

  if (event === "share_outcome") {
    var method =
      props && typeof props.method === "string" ? props.method : "";
    if (!ALLOWED_SHARE_METHOD.has(method)) throw new Error("invalid_method");
    return {
      method: method,
      tab: requireTab(props),
      has_slug: requireBool(props, "has_slug"),
      has_filter: requireBool(props, "has_filter"),
    };
  }

  return props;
}

async function handleKvEvent(env, event, day) {
  var prefix = KV_EVENT_PREFIX[event];
  if (!prefix) throw new Error("unknown_kv_event");
  var kv = env.METRICS_KV;
  if (!kv) throw new Error("metrics_kv_missing");
  await incrementKvCounter(kv, prefix + day);
}

async function handleD1Event(env, event, payload, ts, day) {
  var db = env.METRICS_DB;
  if (!db) throw new Error("metrics_db_missing");
  await ensureSchema(db);

  var props = normalizeD1Props(event, payload.props);

  if (event === "session_start") {
    await db
      .prepare(
        `INSERT INTO clients (client_id, first_seen, last_seen)
         VALUES (?, ?, ?)
         ON CONFLICT(client_id) DO UPDATE SET last_seen = excluded.last_seen`
      )
      .bind(payload.client_id, ts, ts)
      .run();
  }

  await insertEvent(db, ts, day, event, payload, props);
}

export function isMetricsCollectPath(pathname) {
  return pathname === METRICS_PATH;
}

export async function handleMetricsCollect(request, env, allowOrigin) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        Vary: "Origin",
        ...(allowOrigin
          ? {
              "Access-Control-Allow-Origin": allowOrigin,
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
              "Access-Control-Max-Age": "86400",
            }
          : {}),
      },
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(allowOrigin, 405, { ok: false, error: "method_not_allowed" });
  }

  if (!allowOrigin) {
    return jsonResponse(allowOrigin, 403, { ok: false, error: "origin_not_allowed" });
  }

  if (!isProdMetricsRequest(request)) {
    return jsonResponse(allowOrigin, 403, { ok: false, error: "not_prod_app" });
  }

  var payload;
  try {
    payload = await request.json();
  } catch (e) {
    return jsonResponse(allowOrigin, 400, { ok: false, error: "invalid_json" });
  }

  if (!payload || payload.v !== 1) {
    return jsonResponse(allowOrigin, 400, { ok: false, error: "invalid_version" });
  }

  var event = payload.event;
  if (!ALLOWED_EVENTS.has(event)) {
    return jsonResponse(allowOrigin, 400, { ok: false, error: "unknown_event" });
  }

  if (!isValidId(payload.client_id) || !isValidId(payload.session_id)) {
    return jsonResponse(allowOrigin, 400, { ok: false, error: "invalid_ids" });
  }

  var ts = new Date().toISOString();
  var day = utcDay(ts);

  try {
    if (KV_EVENT_PREFIX[event]) {
      await handleKvEvent(env, event, day);
    } else if (D1_EVENTS.has(event)) {
      await handleD1Event(env, event, payload, ts, day);
    }
  } catch (err) {
    var code = err && err.message ? err.message : "store_failed";
    if (CLIENT_ERROR_CODES.has(code)) {
      return jsonResponse(allowOrigin, 400, { ok: false, error: code });
    }
    return jsonResponse(allowOrigin, 503, { ok: false, error: code });
  }

  return jsonResponse(allowOrigin, 200, { ok: true });
}
