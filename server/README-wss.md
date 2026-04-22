# WebSocket scoreboard proxy (Render)

Shared implementation: [\_shared/wss-proxy-core.js](_shared/wss-proxy-core.js).

## Deploy (recommended layout)

- **Root directory:** `server` (so `../_shared` from `dev-martialmatch-v1` / `dev-test-martialmatch-v1` / `prod-martialmatch-v1` resolves on disk).
- **Build command:** `npm install`
- **Start command (pick one service):**
  - Dev + real upstream: `npm run wss:dev` (runs [dev-martialmatch-v1/wss-proxy.js](dev-martialmatch-v1/wss-proxy.js))
  - Production: `npm run wss:prod` ([prod-martialmatch-v1/wss-proxy.js](prod-martialmatch-v1/wss-proxy.js))
  - Devtest (628 JSON fixture, no MartialMatch): `npm run wss:devtest` ([dev-test-martialmatch-v1/wss-proxy.js](dev-test-martialmatch-v1/wss-proxy.js))

## Environment

| Variable | Notes |
|----------|--------|
| `PORT` | Set by Render (or default `8788` locally). |
| `PROXY_MODE` | `production` (default in dev + prod) or `devtest` (default in dev-test). |
| `MM_WSS_URL` | Optional; default `wss://martialmatch.com/_wss` with `Origin: https://martialmatch.com`. |
| `DEVTEST_FIXTURE` | Optional; devtest only. Default: [dev-test-martialmatch-v1/data/websocket/628-wss-timeline.json](dev-test-martialmatch-v1/data/websocket/628-wss-timeline.json). |

## Client ([config.js](../config.js))

Set `WSS_BASE_BY_MODE.prod` and `WSS_BASE_BY_MODE.test` to your deployed `wss://` URLs (same **master / release** pattern as `BASE_BY_MODE` for the HTTP worker). Empty string disables live WebSocket updates in the UI.

## Fixture regeneration

```bash
cd dev-test-martialmatch-v1/data/websocket
node build-628-timeline.cjs
```
