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

## 6. Verify collect (no UI)

After prod release + a few app visits:

**KV** — Workers → KV → MM_METRICS → browse keys for today.

**D1** — Storage → D1 → mm-prod-metrics → Console:

```sql
SELECT COUNT(*) AS clients FROM clients;
SELECT event, COUNT(*) AS n FROM events GROUP BY event ORDER BY n DESC;
```

Optional manual schema (tables are also created on first collect):

```bash
cd server/prod-martialmatch-v1
npx wrangler d1 execute mm-prod-metrics --remote --file=schema.sql
```

## 7. KV write budget

Free tier ≈ 1000 writes/day per namespace. Each counter bump ≈ 2 writes (get + put). Monitor total daily volume if traffic grows.

## 8. Stats dashboard (Phase 3)

**Prod only.** HTML summary at:

```
https://prod-martialmatch-v1.andruwik777.workers.dev/mm/metrics/stats
https://prod-martialmatch-v1.andruwik777.workers.dev/mm/metrics/stats?day=2026-05-27
```

Shows KV daily counters + D1 aggregates for the selected UTC day. Navigation links for previous/next day.

Handler: [`metrics-stats.js`](metrics-stats.js). **Not linked from the public app.**

### Protect with Cloudflare Access + Google

The stats page has **no in-app secret**. Lock it with **Zero Trust Access** so only your Google account(s) can open it.

#### A. One-time Zero Trust setup

1. [Cloudflare dashboard](https://dash.cloudflare.com/) → **Zero Trust** (may need to create a team name — free tier is enough).
2. **Settings** → **Authentication** → **Login methods** → add **Google**.
   - Create an OAuth client in [Google Cloud Console](https://console.cloud.google.com/) (Web application).
   - Authorized redirect URI: use the URL Cloudflare shows when adding Google (typically `https://<your-team>.cloudflareaccess.com/cdn-cgi/access/callback`).
   - Paste Client ID + Client Secret into Cloudflare.

#### B. Access application (prod Worker stats path only)

1. Zero Trust → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. **Application name:** e.g. `MM prod metrics stats`.
3. **Session duration:** e.g. 24 hours (your choice).
4. **Application domain:**
   - **Subdomain:** `prod-martialmatch-v1` (or full hostname `prod-martialmatch-v1.andruwik777.workers.dev` depending on UI).
   - **Domain:** `andruwik777.workers.dev` (workers.dev zone).
   - **Path:** `/mm/metrics/stats` (exact or prefix — do **not** cover `/mm/metrics/collect` or `/api/`).
5. **Policies** → Add policy:
   - **Action:** Allow
   - **Include:** Emails → `you@gmail.com` (add co-maintainers here).
6. Save.

#### C. Verify

1. Open stats URL in a **private window** → should redirect to Google login.
2. Log in with an **allowed** email → HTML dashboard; footer shows `Signed in via Access: …`.
3. Log in with another Google account **not** in policy → blocked.
4. Public app (`POST /mm/metrics/collect`) and API proxy must still work without Access.

#### D. Bookmark

Save the stats URL (no query param needed for today):

```
https://prod-martialmatch-v1.andruwik777.workers.dev/mm/metrics/stats
```

Works on any device where you can sign in with your allowed Google account.

#### E. Warning banner

If Access is **not** configured yet, the page still renders but shows a yellow warning (no `Cf-Access-Authenticated-User-Email` header). Configure Access before sharing the URL.
