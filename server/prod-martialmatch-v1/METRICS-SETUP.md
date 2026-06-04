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

## 5. Verify (no UI)

After prod release + a few app visits:

**KV** — Workers → KV → MM_METRICS → key `metrics:share:YYYY-MM-DD` (increments on Share click).

**D1** — Storage → D1 → mm-prod-metrics → Console:

```sql
SELECT COUNT(*) AS clients FROM clients;
SELECT * FROM events ORDER BY id DESC LIMIT 20;
```

Optional manual schema (tables are also created on first collect):

```bash
cd server/prod-martialmatch-v1
npx wrangler d1 execute mm-prod-metrics --remote --file=schema.sql
```
