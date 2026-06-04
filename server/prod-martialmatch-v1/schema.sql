-- Prod metrics D1 schema (also applied automatically on first collect via metrics-collect.js)
CREATE TABLE IF NOT EXISTS clients (
  client_id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  client_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  props TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_day_event ON events (day, event);
