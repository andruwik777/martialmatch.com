/**
 * Prod-only custom metrics: POST /mm/metrics/collect
 * K1 share_click → KV daily counter
 * D1 session_start → clients + events tables
 */

const METRICS_PATH = "/mm/metrics/collect";
const ALLOWED_EVENTS = new Set(["session_start", "share_click"]);
const PROD_PAGES_PATH = "/martialmatch.com/";

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

function isProdAppReferer(request) {
  var ref = request.headers.get("Referer") || "";
  if (!ref) return true;
  try {
    return new URL(ref).pathname.indexOf(PROD_PAGES_PATH) !== -1;
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

async function handleSessionStart(env, payload, ts, day) {
  var db = env.METRICS_DB;
  if (!db) throw new Error("metrics_db_missing");
  await ensureSchema(db);

  await db
    .prepare(
      `INSERT INTO clients (client_id, first_seen, last_seen)
       VALUES (?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET last_seen = excluded.last_seen`
    )
    .bind(payload.client_id, ts, ts)
    .run();

  var props =
    payload.props && typeof payload.props === "object"
      ? JSON.stringify(payload.props)
      : null;

  await db
    .prepare(
      `INSERT INTO events (ts, day, event, client_id, session_id, props)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(ts, day, "session_start", payload.client_id, payload.session_id, props)
    .run();
}

async function handleShareClick(env, day) {
  var kv = env.METRICS_KV;
  if (!kv) throw new Error("metrics_kv_missing");
  await incrementKvCounter(kv, "metrics:share:" + day);
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

  if (!isProdAppReferer(request)) {
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
    if (event === "session_start") {
      await handleSessionStart(env, payload, ts, day);
    } else if (event === "share_click") {
      await handleShareClick(env, day);
    }
  } catch (err) {
    var code = err && err.message ? err.message : "store_failed";
    return jsonResponse(allowOrigin, 503, { ok: false, error: code });
  }

  return jsonResponse(allowOrigin, 200, { ok: true });
}
