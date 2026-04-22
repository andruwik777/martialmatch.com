/**
 * WebSocket scoreboard proxy — Render (default: production mode to real MM upstream).
 */
"use strict";

var path = require("path");
var { startWssProxy } = require(path.join(__dirname, "..", "_shared", "wss-proxy-core.js"));

/** Same as Cloudflare worker CORS; full list on host: WSS_ALLOWED_ORIGINS=url1,url2 */
var allowedClientOrigins = [
  "https://andruwik777.github.io",
  "http://localhost:8080",
];

startWssProxy({
  mode: process.env.PROXY_MODE || "production",
  upstreamUrl: process.env.MM_WSS_URL,
  port: Number(process.env.PORT) || 8788,
  path: "/",
  allowedClientOrigins: allowedClientOrigins,
});
