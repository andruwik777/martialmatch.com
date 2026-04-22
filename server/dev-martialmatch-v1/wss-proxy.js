/**
 * WebSocket scoreboard proxy — local / dev Render (default: production mode to real MM upstream).
 * Render: set PORT; optional MM_WSS_URL (default wss://martialmatch.com/_wss)
 */
"use strict";

var path = require("path");
var { startWssProxy } = require(path.join(__dirname, "..", "_shared", "wss-proxy-core.js"));

startWssProxy({
  mode: process.env.PROXY_MODE || "production",
  upstreamUrl: process.env.MM_WSS_URL,
  port: Number(process.env.PORT) || 8788,
  path: "/",
});
