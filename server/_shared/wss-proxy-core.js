/**
 * WebSocket proxy: browser clients (JSON lines) <-> scoreboard channels <-> upstream WSS
 * (MartialMatch) or devtest fixture tick. CommonJS; used by server/.../wss-proxy.js
 */
/* eslint-disable no-console */
"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var WebSocket = require("ws");

var MM_DEFAULT_UPSTREAM = "wss://martialmatch.com/_wss";
var MM_UPSTREAM_ORIGIN = "https://martialmatch.com";

/**
 * @param {import("ws").WebSocket} ws
 * @param {string} line
 */
function sendJsonLine(ws, line) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(line);
    } catch (e) {
      /* ignore */
    }
  }
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 */
function handleHttpHealth(req, res) {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return true;
  }
  return false;
}

/**
 * @param {object} opts
 * @param {string} opts.mode "production" | "devtest"
 * @param {string} [opts.upstreamUrl]
 * @param {string} [opts.fixturePath] devtest: path to 628-wss-timeline.json
 * @param {number} [opts.port]
 * @param {string} [opts.path] WebSocket path, default "/"
 */
function startWssProxy(opts) {
  var mode = opts.mode || "production";
  var upstreamUrl = opts.upstreamUrl || process.env.MM_WSS_URL || MM_DEFAULT_UPSTREAM;
  var port = Number(opts.port || process.env.PORT || 8788);
  var mountPath = opts.path || "/";
  if (mountPath !== "/" && mountPath.charAt(0) !== "/") {
    mountPath = "/" + mountPath;
  }

  /** @type {Map<string, { clients: Set<import("ws").WebSocket> }>} */
  var devtestChannels = new Map();
  /** @type {Record<string, any[]>|null} */
  var devtestTimeline = null;
  /** @type {Map<string, number>} */
  var devtestIndex = new Map();
  var devtestTick = null;

  if (mode === "devtest") {
    var fp = opts.fixturePath;
    if (!fp) {
      throw new Error("devtest requires opts.fixturePath");
    }
    var raw = fs.readFileSync(path.resolve(fp), "utf8");
    devtestTimeline = JSON.parse(raw);
    if (typeof devtestTimeline !== "object" || !devtestTimeline) {
      throw new Error("Fixture must be a JSON object of channel -> array");
    }
  }

  /** @type {Map<string, { upstream: import("ws").WebSocket|null, clients: Set<import("ws").WebSocket>, retryTimer: NodeJS.Timeout|null, pendingSub: string[] }>} */
  var prodChannels = new Map();

  function getOrCreateProdEntry(ch) {
    if (!prodChannels.has(ch)) {
      prodChannels.set(ch, {
        upstream: null,
        clients: new Set(),
        retryTimer: null,
        pendingSub: [],
      });
    }
    return prodChannels.get(ch);
  }

  function clearRetryTimer(entry) {
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }
  }

  var WS_OPEN = 1;
  var WS_CONNECTING = 0;

  function scheduleUpstreamReconnect(ch, reason) {
    if (mode !== "production") return;
    var entry = prodChannels.get(ch);
    if (!entry || entry.clients.size === 0) return;
    clearRetryTimer(entry);
    if (reason) {
      console.warn("[wss-proxy] upstream reconnect for", ch, String(reason));
    }
    var delay = 500;
    entry.retryTimer = setTimeout(function doOpen() {
      entry.retryTimer = null;
      if (entry.clients.size === 0) return;
      if (entry.upstream) {
        var st = entry.upstream.readyState;
        if (st === WS_OPEN || st === WS_CONNECTING) {
          return;
        }
      }
      openUpstreamForChannel(ch, entry);
    }, delay);
  }

  function openUpstreamForChannel(ch, entry) {
    if (mode !== "production" || entry.clients.size === 0) return;
    if (entry.upstream) {
      var st = entry.upstream.readyState;
      if (st === WS_OPEN || st === WS_CONNECTING) {
        return;
      }
    }
    if (entry.upstream) {
      try {
        entry.upstream.removeAllListeners();
        entry.upstream.close();
      } catch (e) {
        /* ignore */
      }
      entry.upstream = null;
    }
    var u = new WebSocket(upstreamUrl, {
      headers: { Origin: MM_UPSTREAM_ORIGIN },
    });
    entry.upstream = u;
    u.on("open", function () {
      clearRetryTimer(entry);
      try {
        u.send(JSON.stringify({ channel: ch }));
      } catch (e) {
        console.error("[wss-proxy] subscribe send", ch, e);
      }
    });
    u.on("message", function (data, isBinary) {
      var line = isBinary ? data.toString() : String(data);
      var clients = entry.clients;
      clients.forEach(function (cws) {
        sendJsonLine(cws, line);
      });
    });
    u.on("close", function (code) {
      if (entry.upstream === u) {
        entry.upstream = null;
        scheduleUpstreamReconnect(ch, "close " + String(code));
      }
    });
    u.on("error", function (err) {
      console.error("[wss-proxy] upstream error", ch, err && err.message);
      if (entry.upstream === u) {
        entry.upstream = null;
        scheduleUpstreamReconnect(ch, "error");
      }
    });
  }

  function closeUpstreamForChannel(ch) {
    if (mode !== "production") return;
    var entry = prodChannels.get(ch);
    if (!entry) return;
    clearRetryTimer(entry);
    if (entry.upstream) {
      try {
        if (entry.upstream.readyState === WebSocket.OPEN) {
          entry.upstream.send(
            JSON.stringify({ leaveChannel: true, channel: ch })
          );
        }
        entry.upstream.close();
      } catch (e) {
        /* ignore */
      }
      entry.upstream = null;
    }
  }

  function clientSubscribeToChannel(cws, ch) {
    if (mode === "devtest") {
      if (!devtestTimeline || !Array.isArray(devtestTimeline[ch])) {
        console.warn("[wss-proxy] no fixture for", ch);
        return;
      }
      if (!devtestChannels.has(ch)) {
        devtestChannels.set(ch, { clients: new Set() });
      }
      var dch = devtestChannels.get(ch);
      var isFirstOnChannel = dch.clients.size === 0;
      dch.clients.add(cws);
      startDevtestTickIfNeeded();
      if (isFirstOnChannel) {
        pumpOneDevtestChannel(ch);
      } else {
        sendDevtestCatchupToClient(ch, cws);
      }
      return;
    }
    var entry = getOrCreateProdEntry(ch);
    entry.clients.add(cws);
    if (!entry.upstream || entry.upstream.readyState !== WebSocket.OPEN) {
      openUpstreamForChannel(ch, entry);
    }
  }

  function clientUnsubscribeFromChannel(cws, ch) {
    if (mode === "devtest") {
      var d = devtestChannels.get(ch);
      if (d) {
        d.clients.delete(cws);
        if (d.clients.size === 0) {
          devtestChannels.delete(ch);
        }
      }
      stopDevtestTickIfIdle();
      return;
    }
    var entry = prodChannels.get(ch);
    if (!entry) return;
    entry.clients.delete(cws);
    if (entry.clients.size === 0) {
      closeUpstreamForChannel(ch);
      prodChannels.delete(ch);
    }
  }

  function clientRemoveAllSubscriptions(cws) {
    if (mode === "devtest") {
      devtestChannels.forEach(function (d, ch) {
        d.clients.delete(cws);
        if (d.clients.size === 0) {
          devtestChannels.delete(ch);
        }
      });
      stopDevtestTickIfIdle();
      return;
    }
    prodChannels.forEach(function (entry, ch) {
      if (entry.clients.has(cws)) {
        entry.clients.delete(cws);
        if (entry.clients.size === 0) {
          closeUpstreamForChannel(ch);
          prodChannels.delete(ch);
        }
      }
    });
  }

  function startDevtestTickIfNeeded() {
    if (devtestTick) return;
    devtestTick = setInterval(broadcastDevtestFrame, 1000);
  }

  function stopDevtestTickIfIdle() {
    if (devtestChannels.size > 0) return;
    if (devtestTick) {
      clearInterval(devtestTick);
      devtestTick = null;
    }
  }

  function sendDevtestCatchupToClient(ch, cws) {
    if (!devtestTimeline) return;
    var list = devtestTimeline[ch];
    if (!list || !list.length) return;
    var iNext = devtestIndex.get(ch);
    var idx;
    if (iNext === undefined) {
      idx = 0;
    } else {
      idx = (iNext - 1 + list.length) % list.length;
    }
    var row = list[idx];
    if (row) {
      sendJsonLine(cws, JSON.stringify(row));
    }
  }

  function pumpOneDevtestChannel(ch) {
    if (!devtestTimeline) return;
    var d = devtestChannels.get(ch);
    var list = devtestTimeline[ch];
    if (!d || !list || !list.length) return;
    var i = devtestIndex.get(ch);
    if (i === undefined) {
      i = 0;
    }
    var row = list[i];
    if (row) {
      var line = JSON.stringify(row);
      d.clients.forEach(function (cws) {
        sendJsonLine(cws, line);
      });
    }
    i = (i + 1) % list.length;
    devtestIndex.set(ch, i);
  }

  function broadcastDevtestFrame() {
    if (!devtestTimeline) return;
    devtestChannels.forEach(function (d, ch) {
      pumpOneDevtestChannel(ch);
    });
  }

  var server = http.createServer(function (req, res) {
    if (handleHttpHealth(req, res)) return;
    res.writeHead(404);
    res.end();
  });

  var wss = new WebSocket.Server({ noServer: true });

  server.on("upgrade", function (req, socket, head) {
    if (req.url !== mountPath && mountPath !== "/") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, function (ws) {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", function (cws) {
    cws.on("message", function (data) {
      var line = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
      var msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        return;
      }
      if (msg && msg.leaveChannel && msg.channel) {
        clientUnsubscribeFromChannel(cws, String(msg.channel));
        return;
      }
      if (msg && msg.channel) {
        clientSubscribeToChannel(cws, String(msg.channel));
      }
    });
    cws.on("close", function () {
      clientRemoveAllSubscriptions(cws);
    });
    cws.on("error", function () {
      clientRemoveAllSubscriptions(cws);
    });
  });

  server.listen(port, function () {
    console.log(
      "[wss-proxy] listening " +
        port +
        " mode=" +
        mode +
        (mode === "devtest" ? " fixture=" + (opts.fixturePath || "") : "")
    );
  });
}

module.exports = { startWssProxy, MM_DEFAULT_UPSTREAM };
