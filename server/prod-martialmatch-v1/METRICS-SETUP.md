# Prod custom metrics (KV + D1)

Bindings are **prod worker only** (`prod-martialmatch-v1`). One-time setup in Cloudflare dashboard:

## 1. Create KV namespace

Workers & Pages → **KV** → Create namespace → name e.g. `MM_METRICS`.

Copy the **Namespace ID**.

## 2. Create D1 database

Storage → **D1** → Create → name `mm-prod-metrics`.

Copy the **Database ID**.

## 3. Bind to prod worker

Workers → **prod-martialmatch-v1** → Settings → **Bindings**:

| Type | Variable name | Resource |
|------|---------------|----------|
| KV namespace | `METRICS_KV` | MM_METRICS |
| D1 database | `METRICS_DB` | mm-prod-metrics |

Save and deploy (or push so GitHub autodeploy runs).

## 4. Update wrangler.toml (if deploy uses repo config)

Paste IDs into `server/prod-martialmatch-v1/wrangler.toml` under `[[kv_namespaces]]` and `[[d1_databases]]`.

## 5. Event catalog

### KV (daily counters)

| Event | Key prefix |
|-------|------------|
| `share_click` | `metrics:share:` |
| `qr_open` | `metrics:qr:` |
| `help_open` | `metrics:help:` |
| `fights_refresh` | `metrics:fights_refresh:` |
| `home_nav` | `metrics:home:` |
| `orig_mm_link` | `metrics:orig_link:` |
| `pwa_install_click` | `metrics:pwa_install:` |
| `filter_open` | `metrics:filter_open:` |

Full key: `{prefix}YYYY-MM-DD` (UTC).

### D1 (`events` table)

| Event | props |
|-------|-------|
| `session_start` | `{ tab, standalone }` |
| `tab_view` | `{ tab }` |
| `filter_apply` | `{ kind: "events"\|"slug", tab, count }` |
| `filter_clear` | `{ kind, tab }` |
| `favorite_toggle` | `{ action: "add"\|"remove" }` |
| `event_select` | `{ from_tab }` |
| `change_active_event` | `{ tab }` |
| `share_outcome` | `{ method: "native"\|"clipboard"\|"abort", tab, has_slug, has_filter }` |

No PII (no slugs, athlete IDs, or search text).

## 6. Verify (no UI)

After prod release + a few app visits:

**KV** — Workers → KV → MM_METRICS → browse keys for today.

**D1** — Storage → D1 → mm-prod-metrics → Console:

```sql
SELECT COUNT(*) AS clients FROM clients;
SELECT event, COUNT(*) AS n FROM events GROUP BY event ORDER BY n DESC;
SELECT json_extract(props, '$.kind') AS kind, AVG(CAST(json_extract(props, '$.count') AS INTEGER)) AS avg_count
FROM events WHERE event = 'filter_apply' GROUP BY kind;
SELECT json_extract(props, '$.method') AS method, COUNT(*) AS n
FROM events WHERE event = 'share_outcome' GROUP BY method;
```

Optional manual schema (tables are also created on first collect):

```bash
cd server/prod-martialmatch-v1
npx wrangler d1 execute mm-prod-metrics --remote --file=schema.sql
```

## 7. KV write budget

Free tier ≈ 1000 writes/day per namespace. Each counter bump ≈ 2 writes (get + put). Monitor total daily volume if traffic grows.
