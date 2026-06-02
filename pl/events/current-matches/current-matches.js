(function () {
  "use strict";

  var cfg = window.MM_CONFIG;
  if (!cfg) {
    console.error("MM_CONFIG missing; load config.js first");
    return;
  }

  function eventSlugFromQuery(searchParams) {
    return cfg.parseEventSlug(searchParams.get("slug") || "");
  }

  var evSlug = null;
  var eventNumericId = null;

  function refreshSlugFromLocation() {
    var prevSlugStr = evSlug && evSlug.slug ? evSlug.slug : "";
    var p = new URLSearchParams(window.location.search);
    evSlug = eventSlugFromQuery(p);
    eventNumericId = evSlug ? evSlug.numericId : null;
    var nextSlugStr = evSlug && evSlug.slug ? evSlug.slug : "";
    if (prevSlugStr !== nextSlugStr) {
      /**
       * Active event changed: drop all live overlays/cache to prevent applying
       * stale WSS updates from previous slug during next fights render.
       */
      cmWssInvalidateLiveCacheAndOverlays();
    }
  }

  refreshSlugFromLocation();

  var headerPromptEl = document.getElementById("mm-cm-header-prompt");
  var headerCardWrapEl = document.getElementById("mm-cm-header-card-wrap");
  var headerCardRootEl = document.getElementById("mm-cm-header-card-root");
  var origMmLinkEl = document.getElementById("mm-cm-orig-mm-link");
  var eventsStatusEl = document.getElementById("mm-events-status");
  var eventsListEl = document.getElementById("mm-events-list");

  var errEl = document.getElementById("mm-cm-error");
  var contentEl = document.getElementById("mm-cm-content");
  var placeholderEl = document.getElementById("mm-cm-placeholder");
  var toolbarEl = document.getElementById("mm-cm-toolbar");
  var listEl = document.getElementById("mm-fights-list");
  var tabEventsBtn = document.getElementById("mm-cm-tab-events");
  var tabFightsBtn = document.getElementById("mm-cm-tab-fights");
  var tabHarmonogramBtn = document.getElementById("mm-cm-tab-harmonogram");
  var tabFightsLabelEl = document.getElementById("mm-cm-tab-fights-label");
  var tabFightsRefreshEl = document.getElementById("mm-cm-tab-fights-refresh");
  var tabFightsWssEl = document.getElementById("mm-cm-tab-fights-wss");
  var tabFightsWssDotEl = document.getElementById("mm-cm-tab-fights-wss-dot");
  var panelEventsEl = document.getElementById("mm-cm-panel-events");
  var panelFightsEl = document.getElementById("mm-cm-panel-fights");
  var panelHarmonogramEl = document.getElementById("mm-cm-panel-harmonogram");
  var harmonogramRootEl = document.getElementById("mm-cm-harmonogram-root");

  var CM_TAB_EVENTS = "events";
  var CM_TAB_FIGHTS = "fights";
  var CM_TAB_HARMONOGRAM = "harmonogram";

  /** Shown when schedule/fights data is empty — short, no “API” jargon. */
  var MSG_SCHEDULE_NOT_READY =
    "Schedule isn't ready yet — organizers may still be preparing it.";
  var MSG_FIGHTS_NOT_READY =
    "Fight list isn't ready yet — organizers may still be preparing it.";

  var URL_PARAM_EVENTS_FILTER = "events_filter";
  var URL_PARAM_SLUG_FILTER = "slug_filter";
  var FAVORITES_LS_KEY = "mm_cm_favorites_v1";

  var eventCache = Object.create(null);
  var parsedEventsList = [];
  /** True after the /pl/events index fetch settles (success or error). */
  var eventsIndexLoaded = false;
  /** True while /pl/events fetch is in flight (for Events tab label). */
  var eventsIndexLoading = false;
  /** @type {Record<string, Record<string, true>>} */
  var eventParticipantIdMap = Object.create(null);
  /** @type {Promise<void>|null} */
  var aggregateParticipantMapsPromise = null;

  var MM_ROW_FILTER_HIDDEN = "mm-filter-row--filter-hidden";
  var MM_ROW_SEARCH_HIDDEN = "mm-filter-row--search-hidden";
  var MM_CLUB_FILTER_HIDDEN = "mm-filter-club--filter-hidden";

  var filterRootEl = document.getElementById("mm-cm-filter-root");
  var eventsToolbarEl = document.getElementById("mm-cm-events-toolbar");
  var changeActiveEventBtn = document.getElementById("mm-change-active-event-btn");
  var filterMainBtnEvents = document.getElementById("mm-filter-main-btn-events");
  var filterMainBtn = document.getElementById("mm-filter-main-btn");
  var filterPanelEl = document.getElementById("mm-filter-panel");
  var filterPanelStatusEl = document.getElementById("mm-filter-panel-status");
  var filterPanelHintEl = document.getElementById("mm-filter-panel-hint");
  var filterListRootEl = document.getElementById("mm-filter-list-root");
  var filterApplyStickyBtn = document.getElementById("mm-filter-apply-sticky");
  var filterMobileBarEl = document.getElementById("mm-filter-mobile-bar");
  var filterApplyMobileBtn = document.getElementById("mm-filter-apply-mobile");
  var filterClubJumpWrapEl = document.getElementById("mm-filter-club-jump-wrap");
  var filterClubJumpRootEl = document.getElementById("mm-filter-club-jump-root");
  var filterClubJumpToggleBtn = document.getElementById("mm-filter-club-jump-toggle");
  var filterClubJumpListEl = document.getElementById("mm-filter-club-jump-list");
  var filterClearAllBtn = document.getElementById("mm-filter-clear-all-btn");
  var filterClearAllBtnMobile = document.getElementById(
    "mm-filter-clear-all-btn-mobile"
  );
  var filterOnlySelectedCb = document.getElementById("mm-filter-only-selected-cb");
  var filterOnlyFavoritesCb = document.getElementById("mm-filter-only-favorites-cb");
  var filterOnlyEmptyHintEl = document.getElementById("mm-filter-only-empty-hint");
  var filterSearchInputEl = document.getElementById("mm-filter-search-input");

  var clubJumpOutsideHandler = null;
  var clubJumpEscapeHandler = null;

  var matNamesById = Object.create(null);
  var pollTimerId = null;
  var fightsPollingActive = false;
  var fightsTabStats = { shown: 0, total: 0 };
  /** In-flight fetchJson(fights) count; show tab refresh icon when non-zero */
  var fightsLoadInflight = 0;
  /** @type {object | null} ostatnia poprawna odpowiedź /api/.../fights */
  var lastFightsData = null;

  /** @type {WebSocket|null} */
  var cmWss = null;
  /** @type {Record<string, true>} */
  var cmWssSubscribed = Object.create(null);
  /** @type {Record<string, string>} */
  var cmWssDedupByChannel = Object.create(null);
  /** @type {Record<string, { fightId: * , fightStatus: * }>} */
  var cmWssLastByChannel = Object.create(null);
  /** Last full WSS payload per channel — reapplied after renderFights while socket is open */
  /** @type {Record<string, object>} */
  var cmWssLiveMsgByChannel = Object.create(null);
  /** @type {number|null} */
  var cmWssFightsRefetchDebounce = null;
  /** @type {number|null} */
  var cmWssReconnectTimer = null;
  var cmWssBackoffMs = 2000;
  var CM_WSS_BACKOFF_MAX = 30000;
  var wssLastTrafficPulseAt = 0;
  /** @type {number|null} */
  var wssPingRemoveTimer = null;
  var WSS_TRAFFIC_PULSE_THROTTLE_MS = 400;
  var WSS_PING_CLASS_REMOVE_MS = 200;
  var WSS_DOT_STATE_CLASSES = [
    "mm-cm-tab__wss-dot--na",
    "mm-cm-tab__wss-dot--offline",
    "mm-cm-tab__wss-dot--connecting",
    "mm-cm-tab__wss-dot--open",
  ];
  /** @type {object | null} pełna odpowiedź /api/events/.../schedules */
  var lastSchedulesPayload = null;

  var filterPanelOpen = false;
  /**
   * Flattened rows for the active event (derived from eventCache.startingListsPublic).
   * @type {Array<{publicId:string,name:string,category:string,categoryParameterId:number|null,academyName:string,academyBranch:string,academyId:number,clubDisplayLine:string,nationality:string,isDisqualifiedForNoPayment:boolean}>|null}
   */
  var startingListEntries = null;
  var startingListLoadPromise = null;

  var enCollator = new Intl.Collator("en", { sensitivity: "base" });

  function rowHeadVariant(fightId, matId, queueStatuses) {
    var key = String(matId);
    var q = queueStatuses && queueStatuses[key];
    if (!q || q.fightId !== fightId) return "scheduled";
    if (q.status === 2) return "active";
    if (q.status === 1) return "called";
    return "scheduled";
  }

  function cmWssUrlOk() {
    var u = cfg.wssBaseUrl;
    return typeof u === "string" && u.indexOf("wss://") === 0;
  }

  function formatWssCountdownSec(sec) {
    var s = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (
      (m < 10 ? "0" : "") +
      m +
      ":" +
      (r < 10 ? "0" : "") +
      r
    );
  }

  function mapWssToTopbarVariant(msg) {
    if (!msg || !msg.fightStatus) return null;
    if (msg.fightStatus === "ongoing") {
      return "active";
    }
    if (msg.fightStatus === "awaiting") {
      return "called";
    }
    return null;
  }

  /**
   * Refetch /fights when WSS says a fight is now "called" (awaiting) in situations that
   * usually mean the list / queue is stale: scheduled in API, or a finished ongoing fight.
   * @param {object} m
   * @param {{ fightId: *, fightStatus: * }|null|undefined} prev
   */
  function wssShouldRefetchFightsOnMessage(m, prev) {
    if (!m || m.fightStatus !== "awaiting") {
      return false;
    }
    if (prev && String(prev.fightStatus) === "awaiting") {
      return false;
    }
    if (prev && String(prev.fightStatus) === "ongoing") {
      return true;
    }
    if (!prev) {
      if (!listEl) {
        return false;
      }
      var chMat = String(m.channel || "").match(/^scoreboard:mat:(\d+)$/);
      if (!chMat) {
        return false;
      }
      var a = listEl.querySelector(
        "article.mm-fight[data-mm-mat-id=\"" +
        chMat[1] + "\"][data-mm-fight-id=\"" + String(m.fightId) + "\"]"
      );
      if (!a) {
        return false;
      }
      var tb = a.querySelector(".mm-fight__topbar");
      if (
        tb &&
        tb.classList &&
        tb.classList.contains("mm-fight__topbar--scheduled")
      ) {
        return true;
      }
      return false;
    }
    if (String(prev.fightStatus) === "scheduled" && m.fightStatus === "awaiting") {
      return true;
    }
    return false;
  }

  function wssLiveDedupKey(msg) {
    var blueScore = wssExtractScoreBySide(msg, "blue");
    var redScore = wssExtractScoreBySide(msg, "red");
    return [
      String(msg.fightId || ""),
      String(msg.internalTime != null ? msg.internalTime : ""),
      String(msg.timerClass || ""),
      String(msg.fightStatus || ""),
      wssScoreDedupPart(blueScore.earned),
      wssScoreDedupPart(blueScore.attempt),
      wssScoreDedupPart(blueScore.penalty),
      wssScoreDedupPart(redScore.earned),
      wssScoreDedupPart(redScore.attempt),
      wssScoreDedupPart(redScore.penalty),
    ].join(":");
  }

  function wssScoreDedupPart(part) {
    if (!part || !part.present) {
      return "na";
    }
    return String(part.value);
  }

  /**
   * Scoreboard types where the first competitor is rendered as BLUE on MM.
   * For all other/unknown/missing types we use RED-first as safe fallback.
   * Keep this list tiny and extend only after validating against real MM pages.
   */
  var BLUE_RED_SCOREBOARD_TYPES = {
    bjj: true,
    bjjbluered: true,
  };

  function normalizeScoreboardType(raw) {
    return String(raw != null ? raw : "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function isBlueFirstScoreboardType(scoreboardType) {
    var key = normalizeScoreboardType(scoreboardType);
    return Boolean(key && BLUE_RED_SCOREBOARD_TYPES[key]);
  }

  /**
   * Corner mapping for first/second competitors and competitor1/2 score fields.
   * - Base orientation comes from scoreboardType (blue-first whitelist).
   * - switchedCompetitors=true swaps participants between existing blue/red corners.
   *
   * @param {string|null|undefined} scoreboardType fights.publicFight.scoreboardType
   *   or websocket message `type`
   * @param {boolean} switchedCompetitors
   * @returns {{
   *   blueFromFirst: boolean,
   *   blueParticipantKey: "first"|"second",
   *   redParticipantKey: "first"|"second",
   *   blueScoreKey: "competitor1"|"competitor2",
   *   redScoreKey: "competitor1"|"competitor2"
   * }}
   */
  function resolveCornerMapping(scoreboardType, switchedCompetitors) {
    var blueFromFirst = isBlueFirstScoreboardType(scoreboardType);
    if (switchedCompetitors) {
      blueFromFirst = !blueFromFirst;
    }
    return {
      blueFromFirst: blueFromFirst,
      blueParticipantKey: blueFromFirst ? "first" : "second",
      redParticipantKey: blueFromFirst ? "second" : "first",
      blueScoreKey: blueFromFirst ? "competitor1" : "competitor2",
      redScoreKey: blueFromFirst ? "competitor2" : "competitor1",
    };
  }

  /**
   * Scoreboard payload aliases across event types.
   *
   * We render up to three tiles per corner:
   * - earned (green)
   * - attempt/advantage (yellow)
   * - penalty (red)
   *
   * Source payload families:
   * - Side-native keys (already blue/red oriented):
   *   blueMajorPoints / redMajorPoints, bluePenaltyPoints / redPenaltyPoints, ...
   * - Competitor-indexed keys (bjj-style):
   *   competitor1MajorPoints / competitor2MajorPoints, ...Advantages, ...Penalties
   *
   * Important: `switchedCompetitors` can invert competitor-to-corner relation.
   * For indexed keys we map blue/red to competitor1/2 dynamically:
   * - switchedCompetitors=false: blue->competitor1, red->competitor2
   * - switchedCompetitors=true:  blue->competitor2, red->competitor1
   *
   * Rule: tile is shown only when at least one mapped key exists in payload.
   * Value 0 is still shown (present and currently zero).
   */
  var WSS_SCORE_FIELD_ALIASES_BY_SIDE_NATIVE = {
    blue: {
      earned: [ "blueMajorPoints" ],
      attempt: [ "blueAdvantages" ],
      penalty: [ "bluePenaltyPoints" ],
    },
    red: {
      earned: [ "redMajorPoints" ],
      attempt: [ "redAdvantages" ],
      penalty: [ "redPenaltyPoints" ],
    },
  };

  var WSS_SCORE_FIELD_ALIASES_BY_COMPETITOR = {
    competitor1: {
      earned: [ "competitor1MajorPoints" ],
      attempt: [ "competitor1Advantages" ],
      penalty: [ "competitor1Penalties" ],
    },
    competitor2: {
      earned: [ "competitor2MajorPoints" ],
      attempt: [ "competitor2Advantages" ],
      penalty: [ "competitor2Penalties" ],
    },
  };

  function wssReadScorePartByAliases(msg, aliases) {
    if (!msg || !aliases || !aliases.length) {
      return { present: false, value: 0 };
    }
    for (var i = 0; i < aliases.length; i++) {
      var key = aliases[i];
      if (Object.prototype.hasOwnProperty.call(msg, key)) {
        var raw = msg[key];
        var num = Number(raw);
        return {
          present: true,
          value: isFinite(num) ? num : 0,
        };
      }
    }
    return { present: false, value: 0 };
  }

  function wssCompetitorKeyForCorner(msg, side) {
    var map = resolveCornerMapping(
      msg && msg.type,
      Boolean(msg && msg.switchedCompetitors)
    );
    return side === "blue" ? map.blueScoreKey : map.redScoreKey;
  }

  function wssReadScorePartForCorner(msg, side, kind) {
    var cfgNative = WSS_SCORE_FIELD_ALIASES_BY_SIDE_NATIVE[side] || {};
    var nativePart = wssReadScorePartByAliases(msg, cfgNative[kind] || []);
    if (nativePart.present) {
      return nativePart;
    }
    var competitorKey = wssCompetitorKeyForCorner(msg, side);
    var cfgComp = WSS_SCORE_FIELD_ALIASES_BY_COMPETITOR[competitorKey] || {};
    return wssReadScorePartByAliases(msg, cfgComp[kind] || []);
  }

  function wssExtractScoreBySide(msg, side) {
    return {
      earned: wssReadScorePartForCorner(msg, side, "earned"),
      attempt: wssReadScorePartForCorner(msg, side, "attempt"),
      penalty: wssReadScorePartForCorner(msg, side, "penalty"),
    };
  }

  function buildWssScoreTile(kind, value) {
    var tile = document.createElement("div");
    tile.className = "mm-fight__wss-tile mm-fight__wss-tile--" + kind;
    if (kind === "earned") {
      tile.setAttribute("aria-label", "Earned points");
    } else if (kind === "attempt") {
      tile.setAttribute("aria-label", "Attempt points");
    } else {
      tile.setAttribute("aria-label", "Penalty points");
    }
    tile.textContent = String(value);
    return tile;
  }

  function renderWssScoreTilesForSide(pairEl, score) {
    if (!pairEl || !score) {
      return;
    }
    pairEl.innerHTML = "";
    var shown = 0;
    if (score.earned && score.earned.present) {
      pairEl.appendChild(buildWssScoreTile("earned", score.earned.value));
      shown++;
    }
    if (score.attempt && score.attempt.present) {
      pairEl.appendChild(buildWssScoreTile("attempt", score.attempt.value));
      shown++;
    }
    if (score.penalty && score.penalty.present) {
      pairEl.appendChild(buildWssScoreTile("pen", score.penalty.value));
      shown++;
    }
    if (shown > 0) {
      pairEl.removeAttribute("hidden");
    } else {
      pairEl.setAttribute("hidden", "hidden");
    }
  }

  function cmWssCloneMessageForCache(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      return obj;
    }
  }

  function pruneCmWssLiveCacheForRenderedFights(rows) {
    var want = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var pf = r && r.publicFight;
      if (!pf || pf.id == null || pf.matId == null) {
        continue;
      }
      var chKey = "scoreboard:mat:" + String(pf.matId);
      if (!want[chKey]) {
        want[chKey] = Object.create(null);
      }
      want[chKey][String(pf.id)] = true;
    }
    var chs = Object.keys(cmWssLiveMsgByChannel);
    for (var c = 0; c < chs.length; c++) {
      var ch = chs[c];
      var w = want[ch];
      var msg = cmWssLiveMsgByChannel[ch];
      if (
        !w ||
        !msg ||
        !w[String(msg.fightId)]
      ) {
        delete cmWssLiveMsgByChannel[ch];
      }
    }
  }

  function reapplyCachedWssLiveToFightRows() {
    if (!listEl) {
      return;
    }
    if (getCmTabFromUrl() !== CM_TAB_FIGHTS) {
      return;
    }
    if (!cmWss || cmWss.readyState !== 1) {
      return;
    }
    var chs = Object.keys(cmWssLiveMsgByChannel);
    for (var i = 0; i < chs.length; i++) {
      var ch = chs[i];
      var m = cmWssLiveMsgByChannel[ch];
      if (!m) {
        continue;
      }
      var dkey = wssLiveDedupKey(m);
      cmWssDedupByChannel[ch] = dkey;
      cmWssLastByChannel[ch] = {
        fightId: m.fightId,
        fightStatus: m.fightStatus,
      };
      applyWssLiveToFightRow(m);
    }
  }

  function clearWssLiveOverlaysFromApiQueue() {
    if (!listEl) {
      return;
    }
    var queue =
      (lastFightsData && lastFightsData.fightQueueStatuses) || {};
    var arts = listEl.querySelectorAll(
      "article.mm-fight[data-mm-mat-id][data-mm-fight-id]"
    );
    for (var a = 0; a < arts.length; a++) {
      var art = arts[a];
      var matId = art.getAttribute("data-mm-mat-id");
      var fidStr = art.getAttribute("data-mm-fight-id");
      var fightId = fidStr != null ? Number(fidStr) : NaN;
      if (matId == null || isNaN(fightId)) {
        continue;
      }
      var tb = art.querySelector(".mm-fight__topbar");
      if (tb) {
        var v = rowHeadVariant(fightId, matId, queue);
        tb.className = "mm-fight__topbar mm-fight__topbar--" + v;
      }
      var wssRace = art.querySelector(".mm-fight__wss-race");
      if (wssRace) {
        wssRace.setAttribute("hidden", "hidden");
      }
      var tmr = art.querySelector(".mm-fight__wss-timer");
      if (tmr) {
        tmr.textContent = formatWssCountdownSec(0);
      }
      [ "blue", "red" ].forEach(function (side) {
        var pr = art.querySelector(
          ".mm-fight__athlete--" + side + " .mm-fight__wss-pair"
        );
        if (!pr) {
          return;
        }
        pr.setAttribute("hidden", "hidden");
        pr.innerHTML = "";
      });
    }
  }

  function cmWssInvalidateLiveCacheAndOverlays() {
    cmWssLiveMsgByChannel = Object.create(null);
    cmWssDedupByChannel = Object.create(null);
    cmWssLastByChannel = Object.create(null);
    clearWssLiveOverlaysFromApiQueue();
  }

  /**
   * Mat channels for WSS subscription. When idSet is null/empty (no slug_filter),
   * includes all mats from the fights payload; otherwise only mats for rows that
   * pass the same filter as renderFights (fightMatchesFilter).
   * @param {object|null|undefined} data
   * @param {Record<string, true>|null|undefined} idSet from getSlugFilterIdSetFromUrl
   */
  function buildWssChannelListForFightsData(data, idSet) {
    if (!data || !data.result || !Array.isArray(data.result)) return [];
    var seen = Object.create(null);
    for (var i = 0; i < data.result.length; i++) {
      var r = data.result[i];
      if (!fightMatchesFilter(r, idSet)) {
        continue;
      }
      var pf = r && r.publicFight;
      if (!pf || pf.matId == null) continue;
      seen["scoreboard:mat:" + String(pf.matId)] = true;
    }
    return Object.keys(seen);
  }

  function clearWssPingClassTimer() {
    if (wssPingRemoveTimer != null) {
      clearTimeout(wssPingRemoveTimer);
      wssPingRemoveTimer = null;
    }
  }

  function bumpWssTrafficPulse() {
    if (!tabFightsWssDotEl) {
      return;
    }
    var now = Date.now();
    if (now - wssLastTrafficPulseAt < WSS_TRAFFIC_PULSE_THROTTLE_MS) {
      return;
    }
    wssLastTrafficPulseAt = now;
    tabFightsWssDotEl.classList.add("mm-cm-tab__wss-dot--ping");
    if (wssPingRemoveTimer != null) {
      clearTimeout(wssPingRemoveTimer);
    }
    wssPingRemoveTimer = window.setTimeout(function () {
      wssPingRemoveTimer = null;
      if (tabFightsWssDotEl) {
        tabFightsWssDotEl.classList.remove("mm-cm-tab__wss-dot--ping");
      }
    }, WSS_PING_CLASS_REMOVE_MS);
  }

  function syncFightsWssStatusUi() {
    if (!tabFightsWssEl || !tabFightsWssDotEl) {
      return;
    }
    var show = Boolean(
      evSlug && tabFightsBtn && !tabFightsBtn.disabled
    );
    if (!show) {
      clearWssPingClassTimer();
      if (tabFightsWssDotEl) {
        for (var r = 0; r < WSS_DOT_STATE_CLASSES.length; r++) {
          tabFightsWssDotEl.classList.remove(WSS_DOT_STATE_CLASSES[r]);
        }
        tabFightsWssDotEl.classList.remove("mm-cm-tab__wss-dot--ping");
      }
      tabFightsWssEl.hidden = true;
      return;
    }
    tabFightsWssEl.hidden = false;
    for (var j = 0; j < WSS_DOT_STATE_CLASSES.length; j++) {
      tabFightsWssDotEl.classList.remove(WSS_DOT_STATE_CLASSES[j]);
    }
    if (!cmWssUrlOk()) {
      tabFightsWssDotEl.classList.add("mm-cm-tab__wss-dot--na");
      return;
    }
    if (!cmWss) {
      tabFightsWssDotEl.classList.add("mm-cm-tab__wss-dot--offline");
      return;
    }
    var st = cmWss.readyState;
    if (st === 0) {
      tabFightsWssDotEl.classList.add("mm-cm-tab__wss-dot--connecting");
    } else if (st === 1) {
      tabFightsWssDotEl.classList.add("mm-cm-tab__wss-dot--open");
    } else {
      tabFightsWssDotEl.classList.add("mm-cm-tab__wss-dot--connecting");
    }
  }

  function cmWssClearReconnectTimer() {
    if (cmWssReconnectTimer != null) {
      clearTimeout(cmWssReconnectTimer);
      cmWssReconnectTimer = null;
    }
  }

  function cmWssScheduleReconnect() {
    if (!cmWssUrlOk()) {
      return;
    }
    cmWssClearReconnectTimer();
    cmWssReconnectTimer = window.setTimeout(function () {
      cmWssReconnectTimer = null;
      cmWssConnect();
    }, cmWssBackoffMs);
    cmWssBackoffMs = Math.min(cmWssBackoffMs * 2, CM_WSS_BACKOFF_MAX);
  }

  function cmWssLeaveAllChannels() {
    if (!cmWss || cmWss.readyState !== 1) {
      cmWssSubscribed = Object.create(null);
      return;
    }
    var chs = Object.keys(cmWssSubscribed);
    for (var c = 0; c < chs.length; c++) {
      try {
        cmWss.send(
          JSON.stringify({ leaveChannel: true, channel: chs[c] })
        );
        bumpWssTrafficPulse();
      } catch (e) {
        /* ignore */
      }
    }
    cmWssSubscribed = Object.create(null);
  }

  function cmWssResyncSubscriptionFromFights() {
    if (!cmWss || cmWss.readyState !== 1) {
      return;
    }
    if (!evSlug || getCmTabFromUrl() !== CM_TAB_FIGHTS) {
      return;
    }
    if (!lastFightsData) {
      return;
    }
    var want = buildWssChannelListForFightsData(
      lastFightsData,
      getSlugFilterIdSetFromUrl()
    );
    var wmap = Object.create(null);
    for (var a = 0; a < want.length; a++) {
      wmap[want[a]] = true;
    }
    var cur = Object.keys(cmWssSubscribed);
    for (var i = 0; i < cur.length; i++) {
      if (!wmap[cur[i]] && cmWssSubscribed[cur[i]]) {
        try {
          cmWss.send(
            JSON.stringify({ leaveChannel: true, channel: cur[i] })
          );
          bumpWssTrafficPulse();
        } catch (e) {
          /* ignore */
        }
        delete cmWssSubscribed[cur[i]];
      }
    }
    for (var w = 0; w < want.length; w++) {
      if (!cmWssSubscribed[want[w]]) {
        try {
          cmWss.send(JSON.stringify({ channel: want[w] }));
          bumpWssTrafficPulse();
          cmWssSubscribed[want[w]] = true;
        } catch (e) {
          /* ignore */
        }
      }
    }
  }

  function cmWssConnect() {
    if (!cmWssUrlOk()) {
      syncFightsWssStatusUi();
      return;
    }
    if (cmWss && (cmWss.readyState === 0 || cmWss.readyState === 1)) {
      syncFightsWssStatusUi();
      return;
    }
    try {
      cmWss = new WebSocket(cfg.wssBaseUrl);
    } catch (e) {
      cmWss = null;
      syncFightsWssStatusUi();
      cmWssScheduleReconnect();
      return;
    }
    syncFightsWssStatusUi();
    cmWssBackoffMs = 2000;
    cmWss.addEventListener("open", function () {
      cmWssBackoffMs = 2000;
      cmWssSubscribed = Object.create(null);
      cmWssResyncSubscriptionFromFights();
      reapplyCachedWssLiveToFightRows();
      syncFightsWssStatusUi();
    });
    cmWss.addEventListener("message", function (ev) {
      bumpWssTrafficPulse();
      var m;
      try {
        m = JSON.parse(
          String(ev.data != null ? ev.data : "")
        );
      } catch (e) {
        return;
      }
      if (!m || !m.channel) {
        return;
      }
      var dkey = wssLiveDedupKey(m);
      if (cmWssDedupByChannel[m.channel] === dkey) {
        return;
      }
      var pr = cmWssLastByChannel[m.channel];
      if (
        wssShouldRefetchFightsOnMessage(m, pr) &&
        evSlug &&
        getCmTabFromUrl() === CM_TAB_FIGHTS
      ) {
        scheduleFightsRefetchFromWss();
      }
      cmWssDedupByChannel[m.channel] = dkey;
      cmWssLastByChannel[m.channel] = {
        fightId: m.fightId,
        fightStatus: m.fightStatus,
      };
      cmWssLiveMsgByChannel[m.channel] = cmWssCloneMessageForCache(m);
      applyWssLiveToFightRow(m);
    });
    var sock = cmWss;
    cmWss.addEventListener("close", function () {
      if (cmWss !== sock) {
        return;
      }
      cmWss = null;
      cmWssInvalidateLiveCacheAndOverlays();
      syncFightsWssStatusUi();
      cmWssScheduleReconnect();
    });
    cmWss.addEventListener("error", function () {
      /* close follows */
    });
  }

  function applyWssLiveToFightRow(msg) {
    if (!listEl) {
      return;
    }
    if (!msg || msg.fightId == null) {
      return;
    }
    var matMatch = String(msg.channel || "").match(
      /^scoreboard:mat:(\d+)$/
    );
    if (!matMatch) {
      return;
    }
    var matId = matMatch[1];
    // Multiple rows can share a mat: match the specific fight, not the first
    // article for that mat (querySelector is document-order only).
    var art = listEl.querySelector(
      "article.mm-fight[data-mm-mat-id=\"" +
        String(matId) +
        "\"][data-mm-fight-id=\"" +
        String(msg.fightId) +
        "\"]"
    );
    if (!art) {
      return;
    }
    var v = mapWssToTopbarVariant(msg);
    if (v) {
      var tb = art.querySelector(".mm-fight__topbar");
      if (tb) {
        tb.className = "mm-fight__topbar mm-fight__topbar--" + v;
      }
    }
    var tmr = art.querySelector(".mm-fight__wss-timer");
    var wssRace = art.querySelector(".mm-fight__wss-race");
    if (tmr) {
      tmr.textContent = formatWssCountdownSec(msg.internalTime);
    }
    if (wssRace) {
      wssRace.removeAttribute("hidden");
    }
    [ "blue", "red" ].forEach(function (side) {
      var pair = art.querySelector(
        ".mm-fight__athlete--" + side + " .mm-fight__wss-pair"
      );
      if (!pair) {
        return;
      }
      var score = wssExtractScoreBySide(msg, side);
      renderWssScoreTilesForSide(pair, score);
    });
  }

  /**
   * Fights tab: (re)subscribe to scoreboard channels. Other tabs: leave all mat channels
   * so the proxy is not fan-out–ing to the browser; the WebSocket connection is kept.
   */
  function syncFightsWssForTab() {
    if (!cmWssUrlOk()) {
      return;
    }
    if (evSlug && getCmTabFromUrl() === CM_TAB_FIGHTS) {
      cmWssResyncSubscriptionFromFights();
    } else {
      // Fights is inactive: clear cached live overlays immediately.
      cmWssInvalidateLiveCacheAndOverlays();
      cmWssLeaveAllChannels();
    }
  }

  function parseStartTimeUtc(isoLike) {
    if (!isoLike || typeof isoLike !== "string") return null;
    var m = isoLike.match(
      /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/
    );
    if (!m) return null;
    return new Date(
      Date.UTC(
        parseInt(m[1], 10),
        parseInt(m[2], 10) - 1,
        parseInt(m[3], 10),
        parseInt(m[4], 10),
        parseInt(m[5], 10),
        parseInt(m[6], 10)
      )
    );
  }

  var timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    minute: "2-digit",
  });

  function sortKeyStartTime(startTimeStr) {
    var d = parseStartTimeUtc(startTimeStr);
    return d ? d.getTime() : Number.MAX_SAFE_INTEGER;
  }

  function flagFromNationality(code) {
    if (!code || typeof code !== "string") return "";
    var c = code.toUpperCase();
    if (c.length !== 2) return "";
    var base = 0x1f1e6 - 0x41;
    return String.fromCodePoint(
      base + c.charCodeAt(0),
      base + c.charCodeAt(1)
    );
  }

  /**
   * publicFight.bracketType — integer from MartialMatch fights JSON (not documented
   * in public API). Inferred from real UI + `fights.html` (CSS class names) for event
   * 665, see: server/dev-test-martialmatch-v1/data/665-ground-game-cup-…/fights.json
   * and fights.html. Official “Przebieg walk” only adds extra format chips for **2** and
   * **4** (`3CR` / `RR`); 1 and 3 rely on roundName labels only.
   * - 1: Single-elimination (default ladder); no extra format badge on official site.
   * - 2: Three-competitor repechage; official badge text “3CR”
   *   (`bracket-type-badge-three-competitor-repechage`); often bracketSize 3.
   * - 3: No public badge on official site; appears as normal knockout rounds
   *   (e.g. quarter_final) with a larger tree than simple SE — *likely* double-elim
   *   or a richer structure (hypothesis, confirm with more events if needed).
   * - 4: Round robin; official “RR” (`bracket-type-badge-round-robin`). roundName
   *   like “1/3”, “2/3” = round index within the RR group, not KO fraction “1/8”.
   */
  var MM_BRACKET_TYPE_SINGLE_ELIM = 1;
  var MM_BRACKET_TYPE_THREE_COMPETITOR_REPECHAGE = 2;
  var MM_BRACKET_TYPE_DOUBLE_OR_COMPLEX_ELIM = 3;
  var MM_BRACKET_TYPE_ROUND_ROBIN = 4;

  function roundBadgeList(pf) {
    var rn = (pf.roundName || "").trim();
    var rnl = rn.toLowerCase();
    var list = [];
    if (rnl === "final") list.push({ text: "Final", variant: "final" });
    else if (rnl === "semi_final")
      list.push({ text: "Semifinal", variant: "semi" });
    else if (rnl === "quarter_final")
      list.push({ text: "Quarterfinal", variant: "quarter" });
    else if (
      rnl === "third_place_playoff" ||
      rnl === "repechage_3rd_place"
    )
      list.push({ text: "3rd", variant: "third" });
    else if (rnl === "repechage") list.push({ text: "REP", variant: "round" });
    else if (rn === "1/8" || rnl.indexOf("1/8") === 0)
      list.push({ text: "1/8", variant: "neutral" });
    else if (rn === "1/4" || rnl.indexOf("1/4") === 0)
      list.push({ text: "1/4", variant: "round" });
    else if (rnl.indexOf("1/2") === 0)
      list.push({ text: "1/2", variant: "round" });
    else if (rn) list.push({ text: rn.replace(/_/g, " "), variant: "neutral" });
    return list;
  }

  var MAT_PIN_SVG =
    '<svg class="mm-fight__mat-pin" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>';

  var WSS_CHEQUERED_FLAG_SVG =
    '<svg class="mm-fight__wss-flag" viewBox="0 0 12 9" width="16" height="12" ' +
    'aria-hidden="true" focusable="false">' +
    '<rect x="0" y="0" width="3" height="3" fill="#0d0d0d"/>' +
    '<rect x="3" y="0" width="3" height="3" fill="#edf2f7"/>' +
    '<rect x="6" y="0" width="3" height="3" fill="#0d0d0d"/>' +
    '<rect x="9" y="0" width="3" height="3" fill="#edf2f7"/>' +
    '<rect x="0" y="3" width="3" height="3" fill="#edf2f7"/>' +
    '<rect x="3" y="3" width="3" height="3" fill="#0d0d0d"/>' +
    '<rect x="6" y="3" width="3" height="3" fill="#edf2f7"/>' +
    '<rect x="9" y="3" width="3" height="3" fill="#0d0d0d"/>' +
    '<rect x="0" y="6" width="3" height="3" fill="#0d0d0d"/>' +
    '<rect x="3" y="6" width="3" height="3" fill="#edf2f7"/>' +
    '<rect x="6" y="6" width="3" height="3" fill="#0d0d0d"/>' +
    '<rect x="9" y="6" width="3" height="3" fill="#edf2f7"/>' +
    "</svg>";

  function competitorDisplayName(c) {
    if (!c) return "—";
    var name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
    return name || "—";
  }

  /** Easter egg: random emoji after exact family first+last names (filter rows and fight cards). */
  var FAMILY_EMOJI_POOL = [
    "🥋",
    "🤼",
    "💪",
    "🏆",
    "🔥",
    "👊",
    "⭐",
    "🐻",
    "🐱",
    "🐾",
    "✨",
    "🙂",
    "😊",
    "😄",
    "😎",
  ];
  var FAMILY_NAMES = {
    "Mykhailo Petrov": true,
    "Anna Petrova": true,
  };

  function isFamilyDisplayName(name) {
    var s = String(name != null ? name : "")
      .replace(/\s+/g, " ")
      .trim();
    return Boolean(FAMILY_NAMES[s]);
  }

  function pickRandomFamilyEmoji() {
    return FAMILY_EMOJI_POOL[
      Math.floor(Math.random() * FAMILY_EMOJI_POOL.length)
    ];
  }

  function displayNameWithFamilyEmoji(name) {
    if (!isFamilyDisplayName(name)) return name;
    return name + " " + pickRandomFamilyEmoji();
  }

  /**
   * Canonical club line: "academyName / academyBranch" (aligned with starting-list JSON).
   */
  function formatAcademyClubLine(academyName, academyBranch) {
    var a = String(academyName != null ? academyName : "")
      .replace(/\s+/g, " ")
      .trim();
    var b = String(academyBranch != null ? academyBranch : "")
      .replace(/\s+/g, " ")
      .trim();
    if (a && b) return a + " / " + b;
    if (a) return a;
    if (b) return b;
    return "";
  }

  /**
   * Lowercase + Polish letters to ASCII (for stable filter grouping keys).
   */
  function polishAsciiLowerCore(s) {
    var t = String(s != null ? s : "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    var from = "ąćęłńóśźż";
    var to = "acelnoszz";
    var out = "";
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      var idx = from.indexOf(ch);
      out += idx >= 0 ? to.charAt(idx) : ch;
    }
    return out;
  }

  /** Branch-only normalization for academyId + branch composite group keys. */
  function normalizeAcademyBranchForGrouping(branch) {
    return polishAsciiLowerCore(branch);
  }

  /**
   * Filter / club-jump labels: each word starts with a capital letter (ASCII).
   * Words split on spaces, underscores, hyphens; output words joined with spaces.
   */
  function titleCaseBranchWordsForDisplay(asciiLowerBranch) {
    var parts = String(asciiLowerBranch || "")
      .split(/[\s_-]+/)
      .filter(function (p) {
        return p.length > 0;
      });
    if (!parts.length) return "";
    return parts
      .map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(" ");
  }

  function competitorClubLine(c) {
    if (!c) return "";
    return formatAcademyClubLine(c.academy, c.branch);
  }

  function buildAthleteRow(c, corner) {
    var wrap = document.createElement("div");
    wrap.className = "mm-fight__athlete mm-fight__athlete--" + corner;

    var cornerEl = document.createElement("div");
    cornerEl.className = "mm-fight__corner";
    cornerEl.setAttribute("aria-hidden", "true");

    var main = document.createElement("div");
    main.className = "mm-fight__athlete-main";

    var row1 = document.createElement("div");
    row1.className = "mm-fight__athlete-line1";

    var flag = flagFromNationality(c && c.nationality);
    if (flag) {
      var fspan = document.createElement("span");
      fspan.className = "mm-fight__flag";
      fspan.textContent = flag;
      row1.appendChild(fspan);
    }

    var nm = document.createElement("span");
    nm.className = "mm-fight__name";
    var dn = competitorDisplayName(c);
    nm.textContent = displayNameWithFamilyEmoji(dn);
    if (/^--/.test(String(dn).trim())) {
      nm.classList.add("mm-muted", "mm-fight__name--placeholder");
    }
    row1.appendChild(nm);
    main.appendChild(row1);

    var club = competitorClubLine(c);
    if (club) {
      var clubLine = document.createElement("div");
      clubLine.className = "mm-fight__club";
      clubLine.textContent = club;
      main.appendChild(clubLine);
    }

    var wss = document.createElement("div");
    wss.className = "mm-fight__wss-pair";
    wss.setAttribute("hidden", "hidden");

    wrap.appendChild(cornerEl);
    wrap.appendChild(main);
    wrap.appendChild(wss);
    return wrap;
  }

  /** Show schedule/API mat name as-is; fallback only when name is missing. */
  function buildMatDisplayName(matNameRaw, matId) {
    var s = String(matNameRaw || "").trim();
    return s || "Mat " + String(matId);
  }

  function buildMatMapFromSchedules(payload) {
    var map = Object.create(null);
    if (!payload || typeof payload !== "object") return map;
    var schedules = payload.schedules || [];
    for (var si = 0; si < schedules.length; si++) {
      var sch = schedules[si];
      if (!sch || !sch.mats) continue;
      sch.mats.forEach(function (m) {
        var id = m.id;
        map[String(id)] = m.name || "Mat " + id;
      });
    }
    return map;
  }

  /**
   * @param {object} payload
   * @returns {Record<string, {categoryId:number,categoryName:string,matId:number,matNameRaw:string,start:string,end:string,scheduleId:number,scheduleName:string}>}
   */
  function buildCategoryScheduleIndex(payload) {
    var map = Object.create(null);
    if (!payload || typeof payload !== "object") return map;
    var schedules = payload.schedules || [];
    for (var si = 0; si < schedules.length; si++) {
      var sch = schedules[si];
      if (!sch || !sch.mats) continue;
      var scheduleId = sch.id;
      var scheduleName = sch.name != null ? String(sch.name) : "";
      sch.mats.forEach(function (m) {
        var matId = m.id;
        var matNameRaw = m.name || "Mat " + matId;
        var cats = m.categories || [];
        cats.forEach(function (c) {
          var id = c.id;
          if (id == null) return;
          var key = String(id);
          var t = c.scheduledCategoryTime || {};
          map[key] = {
            categoryId: id,
            categoryName: c.name || "",
            matId: matId,
            matNameRaw: matNameRaw,
            start: t.start || "",
            end: t.end || "",
            scheduleId: scheduleId,
            scheduleName: scheduleName,
          };
        });
      });
    }
    return map;
  }

  function formatHarmonogramTimeRange(startStr, endStr) {
    var a = parseStartTimeUtc(startStr);
    var b = parseStartTimeUtc(endStr);
    var left =
      a && !isNaN(a.getTime()) ? timeFmt.format(a) : "—";
    var right =
      b && !isNaN(b.getTime()) ? timeFmt.format(b) : "—";
    return left + "–" + right;
  }

  /**
   * @param {{ slot: object, members: Array<{name:string,clubDisplayLine:string}> }} row
   */
  function buildHarmonogramCard(row) {
    var slot = row.slot;
    var members = row.members;
    var card = document.createElement("article");
    card.className = "mm-hg-card";

    var meta = document.createElement("div");
    meta.className = "mm-hg-card__meta";

    var catEl = document.createElement("div");
    catEl.className = "mm-hg-card__category";
    catEl.textContent = slot.categoryName || "—";
    meta.appendChild(catEl);

    var sub = document.createElement("div");
    sub.className = "mm-hg-card__sub";
    var matDisplay = buildMatDisplayName(slot.matNameRaw, slot.matId);
    var timeRange = formatHarmonogramTimeRange(slot.start, slot.end);
    sub.textContent = matDisplay + " · " + timeRange;
    meta.appendChild(sub);

    card.appendChild(meta);

    var list = document.createElement("div");
    list.className = "mm-hg-card__athletes";
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      var line = document.createElement("div");
      line.className = "mm-hg-card__athlete";
      var strong = document.createElement("span");
      strong.className = "mm-hg-card__athlete-name";
      strong.textContent = m.name || "—";
      line.appendChild(strong);
      var club = String(m.clubDisplayLine || "").trim();
      if (club && club !== "—") {
        var br = document.createElement("span");
        br.className = "mm-hg-card__athlete-club";
        br.textContent = " (" + club + ")";
        line.appendChild(br);
      }
      list.appendChild(line);
    }
    card.appendChild(list);
    return card;
  }

  function renderHarmonogram() {
    if (!harmonogramRootEl) return;
    harmonogramRootEl.innerHTML = "";

    if (!lastSchedulesPayload) {
      var p = document.createElement("p");
      p.className = "mm-muted";
      p.textContent = MSG_SCHEDULE_NOT_READY;
      harmonogramRootEl.appendChild(p);
      return;
    }

    if (!schedulesPayloadHasData(lastSchedulesPayload)) {
      var pSched = document.createElement("p");
      pSched.className = "mm-muted";
      pSched.textContent = MSG_SCHEDULE_NOT_READY;
      harmonogramRootEl.appendChild(pSched);
      return;
    }

    if (startingListEntries == null) {
      var p2 = document.createElement("p");
      p2.className = "mm-muted";
      p2.textContent = "Loading starting list…";
      harmonogramRootEl.appendChild(p2);
      return;
    }

    if (!startingListEntries.length) {
      var pEmpty = document.createElement("p");
      pEmpty.className = "mm-muted";
      pEmpty.textContent =
        "No athletes on the starting list for this event.";
      harmonogramRootEl.appendChild(pEmpty);
      return;
    }

    var index = buildCategoryScheduleIndex(lastSchedulesPayload);
    var idSet = getSlugFilterIdSetFromUrl();
    var filtered = startingListEntries.filter(function (e) {
      if (e.categoryParameterId == null) return false;
      if (idSet && !idSet[e.publicId]) return false;
      return true;
    });

    var byCat = Object.create(null);
    for (var i = 0; i < filtered.length; i++) {
      var ent = filtered[i];
      var k = String(ent.categoryParameterId);
      if (!byCat[k]) byCat[k] = [];
      byCat[k].push(ent);
    }

    var keys = Object.keys(byCat);
    var rows = [];
    for (var j = 0; j < keys.length; j++) {
      var catKey = keys[j];
      var slot = index[catKey];
      if (!slot) continue;
      var rawMembers = byCat[catKey];
      var seen = Object.create(null);
      var members = [];
      for (var m = 0; m < rawMembers.length; m++) {
        var r = rawMembers[m];
        if (seen[r.publicId]) continue;
        seen[r.publicId] = true;
        members.push(r);
      }
      members.sort(compareEntriesByName);
      rows.push({ slot: slot, members: members });
    }

    rows.sort(function (a, b) {
      return sortKeyStartTime(a.slot.start) - sortKeyStartTime(b.slot.start);
    });

    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "mm-muted";
      empty.textContent = idSet
        ? "No schedule rows for selected athletes (starting list needs parameterId links)."
        : "No matches: starting list without parameterId or categories outside schedule.";
      harmonogramRootEl.appendChild(empty);
      return;
    }

    var wrap = document.createElement("div");
    wrap.className = "mm-hg-list";
    var multiDay =
      Array.isArray(lastSchedulesPayload.schedules) &&
      lastSchedulesPayload.schedules.length > 1;
    var prevScheduleKey = null;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var slot = row.slot;
      if (multiDay) {
        var sk =
          slot.scheduleId != null ? String(slot.scheduleId) : "__none__";
        if (sk !== prevScheduleKey) {
          prevScheduleKey = sk;
          var head = document.createElement("div");
          head.className = "mm-hg-day-heading";
          head.setAttribute("role", "heading");
          head.setAttribute("aria-level", "3");
          head.textContent =
            (slot.scheduleName && String(slot.scheduleName).trim()) ||
            "Schedule";
          wrap.appendChild(head);
        }
      }
      wrap.appendChild(buildHarmonogramCard(row));
    }
    harmonogramRootEl.appendChild(wrap);
  }

  function refreshHarmonogram() {
    renderHarmonogram();
  }

  var KNOWN_EVENT_TYPE_KEYS = {
    Grappling: true,
    BjjGi: true,
    BjjNoGi: true,
    MMA: true,
    CombatJuJutsu: true,
    ADCC: true,
    Sambo: true,
    Judo: true,
    SubmissionOnly: true,
    Kickboxing: true,
    Boxing: true,
    Wrestling: true,
    MuayThai: true,
    Taekwondo: true,
  };

  function escapeHtmlEv(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function flagEmojiEv(code) {
    if (!code || String(code).length !== 2) return "";
    var c = String(code).toUpperCase();
    var base = 0x1f1e6 - 0x41;
    return String.fromCodePoint(
      base + c.charCodeAt(0),
      base + c.charCodeAt(1)
    );
  }

  var POLISH_MONTH_TO_INDEX = {
    stycznia: 0,
    lutego: 1,
    marca: 2,
    kwietnia: 3,
    maja: 4,
    czerwca: 5,
    lipca: 6,
    sierpnia: 7,
    września: 8,
    wrzesnia: 8,
    października: 9,
    pazdziernika: 9,
    listopada: 10,
    grudnia: 11,
  };

  function parsePolishEventDate(dateText) {
    if (!dateText || typeof dateText !== "string") return null;
    var s = dateText.replace(/\s+/g, " ").replace(/[.,;]+$/g, "").trim();
    var m = s.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/);
    if (!m) return null;
    var day = parseInt(m[1], 10);
    var monthKey = m[2].toLowerCase();
    var year = parseInt(m[3], 10);
    var monthIdx = POLISH_MONTH_TO_INDEX[monthKey];
    if (monthIdx === undefined || day < 1 || day > 31) return null;
    var d = new Date(year, monthIdx, day, 12, 0, 0, 0);
    if (
      d.getFullYear() !== year ||
      d.getMonth() !== monthIdx ||
      d.getDate() !== day
    ) {
      return null;
    }
    return d;
  }

  function startOfLocalDayEv(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /**
   * @returns {{ start: Date, end: Date } | null}
   */
  function parsePolishEventDateSpan(dateText) {
    if (!dateText || typeof dateText !== "string") return null;
    var s = dateText.replace(/\s+/g, " ").replace(/[.,;]+$/g, "").trim();
    var rm = s.match(/^(\d{1,2})\s*[–-]\s*(\d{1,2})\s+(\S+)\s+(\d{4})$/);
    if (rm) {
      var dayA = parseInt(rm[1], 10);
      var dayB = parseInt(rm[2], 10);
      var monthKey = rm[3].toLowerCase();
      var year = parseInt(rm[4], 10);
      var monthIdx = POLISH_MONTH_TO_INDEX[monthKey];
      if (monthIdx === undefined) return null;
      var lo = Math.min(dayA, dayB);
      var hi = Math.max(dayA, dayB);
      var start = new Date(year, monthIdx, lo, 12, 0, 0, 0);
      var end = new Date(year, monthIdx, hi, 12, 0, 0, 0);
      if (
        start.getFullYear() !== year ||
        end.getFullYear() !== year ||
        start.getMonth() !== monthIdx ||
        end.getMonth() !== monthIdx ||
        start.getDate() !== lo ||
        end.getDate() !== hi
      ) {
        return null;
      }
      return { start: start, end: end };
    }
    var single = parsePolishEventDate(s);
    if (!single) return null;
    return { start: single, end: single };
  }

  function isLocalDateInEventSpanEv(ref, span) {
    if (!span) return false;
    ref = ref || new Date();
    var r = startOfLocalDayEv(ref).getTime();
    var a = startOfLocalDayEv(span.start).getTime();
    var b = startOfLocalDayEv(span.end).getTime();
    return r >= a && r <= b;
  }

  /** When HTML has no registration row: infer "ongoing" from competition date span. */
  function registrationFallbackFromEventDates(dateText) {
    var span = parsePolishEventDateSpan(dateText);
    if (!span) return null;
    if (isLocalDateInEventSpanEv(new Date(), span)) {
      return { kind: "ongoing", text: "Event ongoing" };
    }
    return null;
  }

  /**
   * Status rejestracji / „Trwające zawody” — szukamy po całym wierszu karty (nie po
   * pierwszym .has-added-padding, bo to często kolumna z miniaturą bez .event-date).
   */
  function parseRegistrationEv(row) {
    var candidates = row.querySelectorAll(
      "span.has-text-success, span.has-text-info, span.has-text-warning"
    );
    var i;
    var maxLen = 200;

    function skipContext(el) {
      if (!el) return true;
      if (el.closest(".tags")) return true;
      if (el.closest(".event-date")) return true;
      return false;
    }

    for (i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (skipContext(el)) continue;
      var txt = el.textContent.replace(/\s+/g, " ").trim();
      if (!txt || txt.length > maxLen) continue;

      if (/Trwające\s+zawody/i.test(txt)) {
        return { kind: "ongoing", text: txt };
      }
      if (/Rejestracja\s+zakończona/i.test(txt)) {
        return { kind: "closed", text: txt };
      }
      if (/Rejestracja\s+zakonczona/i.test(txt)) {
        return { kind: "closed", text: txt };
      }
      if (/Start\s+rejestracji/i.test(txt)) {
        return { kind: "start", text: txt };
      }
      if (/Koniec\s+rejestracji/i.test(txt)) {
        return { kind: "end", text: txt };
      }
    }

    for (i = 0; i < candidates.length; i++) {
      var el2 = candidates[i];
      if (skipContext(el2)) continue;
      var t2 = el2.textContent.replace(/\s+/g, " ").trim();
      if (!t2 || t2.length > maxLen) continue;
      var cls = el2.className || "";
      if (cls.indexOf("has-text-warning") !== -1) {
        return { kind: "closed", text: t2 };
      }
      if (cls.indexOf("has-text-info") !== -1) {
        return { kind: "start", text: t2 };
      }
      if (cls.indexOf("has-text-success") !== -1) {
        if (/Trwające/i.test(t2)) return { kind: "ongoing", text: t2 };
        return { kind: "end", text: t2 };
      }
    }
    return null;
  }

  function registrationHtmlEv(reg) {
    if (!reg) return "";
    var t = reg.text;
    if (reg.kind === "start") {
      var ms = t.match(/^(Start\s+rejestracji:)\s*(.+)$/i);
      if (ms) {
        return (
          escapeHtmlEv(ms[1]) +
          " <strong>" +
          escapeHtmlEv(ms[2].trim()) +
          "</strong>"
        );
      }
    }
    if (reg.kind === "end") {
      var me = t.match(/^(Koniec\s+rejestracji:)\s*(.+)$/i);
      if (me) {
        return (
          escapeHtmlEv(me[1]) +
          " <strong>" +
          escapeHtmlEv(me[2].trim()) +
          "</strong>"
        );
      }
    }
    return escapeHtmlEv(t);
  }

  function parsePlaceAndFlagEv(row) {
    var marker = row.querySelector(".fa-map-marker-alt");
    var locRow = marker && marker.closest(".is-size-6");
    var countryCode = "";
    var place = "";
    if (!locRow) return { countryCode: countryCode, place: place };

    var flagEl = locRow.querySelector("i.flag-icon");
    if (flagEl && flagEl.classList) {
      flagEl.classList.forEach(function (c) {
        var m = /^flag-icon-([a-z]{2})$/i.exec(c);
        if (m) countryCode = m[1].toLowerCase();
      });
    }

    var spans = locRow.querySelectorAll("span");
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      if (sp.querySelector(".fa-map-marker-alt")) continue;
      if (sp.querySelector("i.flag-icon")) continue;
      var t = sp.textContent.replace(/\s+/g, " ").trim();
      if (t && t.length < 120) place = t;
    }
    return { countryCode: countryCode, place: place };
  }

  function parseEventTypeTagsEv(row) {
    var out = [];
    row.querySelectorAll(".tag.is-event-type").forEach(function (el) {
      var typeKey = "";
      el.classList.forEach(function (c) {
        if (c === "tag" || c === "is-event-type") return;
        typeKey = c;
      });
      if (!typeKey) return;
      out.push({
        key: typeKey,
        label: el.textContent.replace(/\s+/g, " ").trim() || typeKey,
      });
    });
    return out;
  }

  function parseEventsFromDocument(doc) {
    var links = doc.querySelectorAll("a.event-image-link[href*='/events/']");
    var out = [];
    var seen = Object.create(null);

    links.forEach(function (a) {
      var href = a.getAttribute("href") || "";
      var pathMatch = href.match(/\/events\/([^/?#]+)/);
      if (!pathMatch) return;
      var slug = pathMatch[1];
      var parsed = cfg.parseEventSlug(slug);
      if (!parsed) return;
      if (seen[parsed.slug]) return;
      seen[parsed.slug] = true;

      var row = a.closest("div.columns.is-centered.is-gapless");
      if (!row) return;

      var titleEl = row.querySelector("a.has-text-white");
      var title = titleEl
        ? titleEl.textContent.replace(/\s+/g, " ").trim()
        : "";

      var img = a.querySelector("img.event-thumbnail");
      var thumb = img ? (img.getAttribute("src") || "").trim() : "";

      var dateEl = row.querySelector(".event-date");
      var dateText = dateEl
        ? dateEl.textContent
            .replace(/\s+/g, " ")
            .replace(/Data zawodów:\s*/i, "")
            .trim()
        : "";

      var pf = parsePlaceAndFlagEv(row);
      var registration = parseRegistrationEv(row);
      var tags = parseEventTypeTagsEv(row);

      if (!registration) {
        registration = registrationFallbackFromEventDates(dateText);
      }

      out.push({
        slug: parsed.slug,
        numericId: parsed.numericId,
        title: title,
        thumb: thumb,
        dateText: dateText,
        place: pf.place,
        countryCode: pf.countryCode,
        registration: registration,
        tags: tags,
      });
    });

    return out;
  }

  var PLACE_PIN_SVG_EV =
    '<svg class="mm-ev-place__pin" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>';

  function refreshEventsListVisibility() {
    if (!eventsListEl) {
      updateEventsTabLabel();
      return;
    }
    var articles = eventsListEl.querySelectorAll(".mm-event-row");

    for (var c = 0; c < articles.length; c++) {
      articles[c].classList.remove("mm-event-row--filtered-out");
    }

    var idSet = getEventsFilterIdSetFromUrl();
    if (!idSet || !Object.keys(idSet).length) {
      updateEventsTabLabel();
      return;
    }
    var mapsEmpty = true;
    for (var mp in eventParticipantIdMap) {
      mapsEmpty = false;
      break;
    }
    if (mapsEmpty) {
      updateEventsTabLabel();
      return;
    }
    for (var i = 0; i < articles.length; i++) {
      var art = articles[i];
      var nid = art.getAttribute("data-mm-event-id") || "";
      var map = eventParticipantIdMap[nid];
      var show = false;
      if (map) {
        for (var pid in idSet) {
          if (map[pid]) {
            show = true;
            break;
          }
        }
      }
      if (!show) {
        art.classList.add("mm-event-row--filtered-out");
      }
    }
    updateEventsTabLabel();
  }

  /** Events tab: non-empty events_filter in URL (list rows may be narrowed). */
  function eventsUrlFilterActive() {
    var idSet = getEventsFilterIdSetFromUrl();
    return Boolean(idSet && Object.keys(idSet).length);
  }

  function updateEventsTabLabel() {
    if (!tabEventsBtn) return;
    if (eventsIndexLoading) {
      tabEventsBtn.textContent = "Events …";
      tabEventsBtn.setAttribute("aria-label", "Events tab, loading list");
      return;
    }
    var total = parsedEventsList.length;
    if (!eventsListEl) {
      tabEventsBtn.textContent = "Events";
      tabEventsBtn.setAttribute(
        "aria-label",
        total === 0
          ? "Events tab, no events loaded"
          : "Events tab, " + total + " events"
      );
      return;
    }
    var rows = eventsListEl.querySelectorAll(".mm-event-row");
    var visible = 0;
    var ri;
    for (ri = 0; ri < rows.length; ri++) {
      if (!rows[ri].classList.contains("mm-event-row--filtered-out")) {
        visible++;
      }
    }
    var denom = total > 0 ? total : rows.length;
    if (denom === 0) {
      tabEventsBtn.textContent = "Events";
      tabEventsBtn.setAttribute("aria-label", "Events tab, no events");
      return;
    }
    var filtered = eventsUrlFilterActive();
    if (filtered) {
      tabEventsBtn.textContent = "Events " + visible + "/" + denom;
      tabEventsBtn.setAttribute(
        "aria-label",
        "Events tab, " + visible + " of " + denom + " events match filter"
      );
    } else {
      tabEventsBtn.textContent = "Events";
      tabEventsBtn.setAttribute(
        "aria-label",
        "Events tab, " + denom + " events"
      );
    }
  }

  function setEventsStatus(msg, isError) {
    if (!eventsStatusEl) return;
    eventsStatusEl.textContent = msg || "";
    eventsStatusEl.classList.toggle("mm-status--error", !!isError);
  }

  function highlightSelectedEventRow(slugStr) {
    if (!eventsListEl) return;
    var rows = eventsListEl.querySelectorAll(".mm-event-row");
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var s = r.getAttribute("data-mm-event-slug") || "";
      r.classList.toggle("mm-event-row--selected", Boolean(slugStr && s === slugStr));
    }
  }

  function schedulesPayloadHasData(payload) {
    return Boolean(
      payload &&
      typeof payload === "object" &&
      Array.isArray(payload.schedules) &&
      payload.schedules.length > 0
    );
  }

  function fightsDataHasData(data) {
    return Boolean(
      data &&
      typeof data === "object" &&
      Array.isArray(data.result) &&
      data.result.length > 0
    );
  }

  function httpStatusFromFetchError(err) {
    if (!err || err.message == null) return 0;
    var m = String(err.message).match(/HTTP (\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function laneOk(has) {
    return { error: false, has: !!has };
  }

  function laneHttpError(status) {
    return { error: true, has: false, status: status || 0 };
  }

  /**
   * @param {HTMLElement} wrap
   * @param {string} nid
   */
  function paintEventCardLaneStrip(wrap, nid) {
    if (!wrap) return;
    wrap.innerHTML = "";
    var c = eventCache[nid] || {};
    var triple = [
      {
        lane: c.laneStarting,
        mod: "starting",
        tFill: "Starting list: athletes present.",
        tOut: "Starting list: no athletes (server response).",
        tErr: "Starting list: request failed",
      },
      {
        lane: c.laneSchedules,
        mod: "schedules",
        tFill: "Schedule: API returned schedules.",
        tOut: "Schedule: API returned no schedules.",
        tErr: "Schedule: request failed",
      },
      {
        lane: c.laneFights,
        mod: "fights",
        tFill: "Fights: API returned at least one fight.",
        tOut: "Fights: API returned no fights.",
        tErr: "Fights: request failed",
      },
    ];
    for (var i = 0; i < triple.length; i++) {
      var slot = document.createElement("div");
      slot.className = "mm-event-lane-slot";
      var t = triple[i];
      if (t.lane == null) {
        wrap.appendChild(slot);
        continue;
      }
      var dot = document.createElement("span");
      var ln = t.lane;
      if (ln.error) {
        dot.className =
          "mm-event-lane mm-event-lane--" + t.mod + " mm-event-lane--error";
        var st = ln.status;
        dot.setAttribute(
          "title",
          st
            ? t.tErr + " (HTTP " + st + ")."
            : t.tErr + " (network or unknown error)."
        );
      } else {
        dot.className =
          "mm-event-lane mm-event-lane--" +
          t.mod +
          (ln.has ? " mm-event-lane--filled" : " mm-event-lane--outline");
        dot.setAttribute("title", ln.has ? t.tFill : t.tOut);
      }
      slot.appendChild(dot);
      wrap.appendChild(slot);
    }
  }

  function buildEventLaneStrip(nid) {
    var wrap = document.createElement("div");
    wrap.className = "mm-event-row__lanes";
    wrap.setAttribute("aria-hidden", "true");
    paintEventCardLaneStrip(wrap, nid);
    return wrap;
  }

  function refreshLanesForNumericId(nid) {
    var idStr = String(nid);
    if (eventsListEl) {
      var row = eventsListEl.querySelector(
        '[data-mm-event-id="' + idStr + '"]'
      );
      if (row) {
        var w = row.querySelector(".mm-event-row__lanes");
        if (w) paintEventCardLaneStrip(w, idStr);
      }
    }
    if (
      evSlug &&
      String(evSlug.numericId) === idStr &&
      headerCardRootEl
    ) {
      var hRow = headerCardRootEl.querySelector(".mm-event-row");
      if (hRow) {
        var hw = hRow.querySelector(".mm-event-row__lanes");
        if (hw) paintEventCardLaneStrip(hw, idStr);
      }
    }
  }

  /**
   * Home reset: drop per-event API bundle + lane dots; keep list card metadata from index.
   */
  function resetEventApiCacheForHome() {
    aggregateParticipantMapsPromise = null;
    for (var ek in eventParticipantIdMap) {
      delete eventParticipantIdMap[ek];
    }
    if (parsedEventsList.length) {
      for (var ti = 0; ti < parsedEventsList.length; ti++) {
        var evo = parsedEventsList[ti];
        var enid = evo.numericId;
        eventCache[enid] = {
          title: evo.title || "",
          registration: evo.registration,
          dateText: evo.dateText || "",
          place: evo.place || "",
          countryCode: evo.countryCode || "",
          thumb: evo.thumb || "",
          tags: evo.tags || [],
        };
        refreshLanesForNumericId(enid);
      }
      return;
    }
    for (var nid in eventCache) {
      if (!Object.prototype.hasOwnProperty.call(eventCache, nid)) continue;
      var prev = eventCache[nid];
      eventCache[nid] = {
        title: prev.title || "",
        registration: prev.registration,
        dateText: prev.dateText || "",
        place: prev.place || "",
        countryCode: prev.countryCode || "",
        thumb: prev.thumb || "",
        tags: prev.tags || [],
      };
      refreshLanesForNumericId(nid);
    }
  }

  function buildEventThumbPlaceholder() {
    var ph = document.createElement("div");
    ph.className = "mm-event-thumb-placeholder";
    ph.setAttribute("role", "img");
    ph.setAttribute(
      "aria-label",
      "Placeholder — no event thumbnail"
    );
    ph.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.3"/><path d="M21 15l-4.5-4.5L5 21"/></svg>';
    return ph;
  }

  /**
   * @param {object} ev
   * @param {{ interactive?: boolean, headerCompact?: boolean }} opts
   */
  function buildEventCardNode(ev, opts) {
    opts = opts || {};
    var interactive = !!opts.interactive;
    var headerCompact = !!opts.headerCompact;
    var root = document.createElement(interactive ? "article" : "div");
    root.className =
      "event-card mm-event-row" +
      (interactive ? "" : " mm-event-row--display-only") +
      (headerCompact ? " mm-event-row--header-compact" : "");
    root.setAttribute("data-mm-event-id", ev.numericId);
    root.setAttribute("data-mm-event-slug", ev.slug);
    if (interactive) {
      root.setAttribute("role", "button");
      root.tabIndex = 0;
      root.setAttribute(
        "aria-label",
        "Select event: " + (ev.title || ev.slug)
      );
    }

    var media = document.createElement("div");
    media.className = "mm-event-row__media";
    var thumbUrl = (ev.thumb && String(ev.thumb).trim()) || "";
    if (thumbUrl) {
      var img = document.createElement("img");
      img.className = "event-card-thumb";
      img.alt = "";
      img.loading = "lazy";
      img.src = thumbUrl;
      img.draggable = false;
      img.onerror = function () {
        img.replaceWith(buildEventThumbPlaceholder());
      };
      media.appendChild(img);
    } else {
      media.appendChild(buildEventThumbPlaceholder());
    }

    var body = document.createElement("div");
    body.className = "event-card-body";

    var titleEl = document.createElement("div");
    titleEl.className = "event-card-title";
    titleEl.textContent = ev.title || "Event " + ev.numericId;
    body.appendChild(titleEl);

    if (ev.dateText) {
      var dateRow = document.createElement("div");
      dateRow.className = "mm-ev-date";
      var lab = document.createElement("span");
      lab.className = "mm-ev-date__label";
      lab.textContent = "Date:";
      var val = document.createElement("span");
      val.className = "mm-ev-date__value";
      val.textContent = " " + ev.dateText;
      dateRow.appendChild(lab);
      dateRow.appendChild(val);
      body.appendChild(dateRow);
    }

    if (!headerCompact) {
      if (ev.registration) {
        var regEl = document.createElement("div");
        regEl.className = "mm-ev-reg mm-ev-reg--" + ev.registration.kind;
        regEl.innerHTML = registrationHtmlEv(ev.registration);
        body.appendChild(regEl);
      }

      if (ev.place || ev.countryCode) {
        var placeRow = document.createElement("div");
        placeRow.className = "mm-ev-place";
        placeRow.innerHTML = PLACE_PIN_SVG_EV;
        if (ev.countryCode) {
          var fl = document.createElement("span");
          fl.className = "mm-ev-place__flag";
          fl.textContent = flagEmojiEv(ev.countryCode);
          fl.setAttribute("aria-hidden", "true");
          placeRow.appendChild(fl);
        }
        var city = document.createElement("span");
        city.className = "mm-ev-place__city";
        city.textContent = ev.place || "";
        placeRow.appendChild(city);
        body.appendChild(placeRow);
      }

      if (ev.tags && ev.tags.length) {
        var tagRoot = document.createElement("div");
        tagRoot.className = "mm-ev-tags";
        ev.tags.forEach(function (t) {
          var sp = document.createElement("span");
          var mod = KNOWN_EVENT_TYPE_KEYS[t.key] ? t.key : "default";
          sp.className = "mm-ev-tag mm-ev-tag--" + mod;
          sp.textContent = t.label;
          tagRoot.appendChild(sp);
        });
        body.appendChild(tagRoot);
      }
    }

    root.appendChild(media);
    root.appendChild(body);
    root.appendChild(buildEventLaneStrip(ev.numericId));
    return root;
  }

  function renderEventsListCm(events) {
    if (!eventsListEl) return;
    eventsListEl.innerHTML = "";

    events.forEach(function (ev) {
      eventsListEl.appendChild(buildEventCardNode(ev, { interactive: true }));
    });

    highlightSelectedEventRow(evSlug ? evSlug.slug : "");
  }

  function getEventSummaryForHeader() {
    if (!evSlug || !eventNumericId) return null;
    var i;
    for (i = 0; i < parsedEventsList.length; i++) {
      if (parsedEventsList[i].slug === evSlug.slug) {
        return parsedEventsList[i];
      }
    }
    var c = eventCache[eventNumericId];
    var title = (c && c.title) || "Event " + eventNumericId;
    return {
      slug: evSlug.slug,
      numericId: eventNumericId,
      title: title,
      thumb: (c && c.thumb) || "",
      dateText: (c && c.dateText) || "",
      place: (c && c.place) || "",
      countryCode: (c && c.countryCode) || "",
      registration: c ? c.registration : null,
      tags: (c && c.tags) || [],
    };
  }

  function loadEventsIndex() {
    eventsIndexLoading = true;
    setEventsStatus("");
    updateEventsTabLabel();
    var url = cfg.url("/pl/events");

    return fetch(url, { credentials: "omit", headers: { Accept: "text/html" } })
      .then(function (res) {
        if (!res.ok) {
          throw new Error("HTTP " + res.status);
        }
        return res.text();
      })
      .then(function (html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, "text/html");
        var events = parseEventsFromDocument(doc);
        if (events.length === 0) {
          setEventsStatus(
            "No events found in HTML (site structure may have changed).",
            true
          );
          parsedEventsList = [];
          updateEventsTabLabel();
          return;
        }
        aggregateParticipantMapsPromise = null;
        for (var ek in eventParticipantIdMap) {
          delete eventParticipantIdMap[ek];
        }
        parsedEventsList = events;
        for (var ti = 0; ti < events.length; ti++) {
          var evo = events[ti];
          var enid = evo.numericId;
          if (!eventCache[enid]) eventCache[enid] = {};
          eventCache[enid].title = evo.title || "";
          eventCache[enid].registration = evo.registration;
          eventCache[enid].dateText = evo.dateText || "";
          eventCache[enid].place = evo.place || "";
          eventCache[enid].countryCode = evo.countryCode || "";
          eventCache[enid].thumb = evo.thumb || "";
          eventCache[enid].tags = evo.tags || [];
        }
        eventsIndexLoading = false;
        setEventsStatus("");
        renderEventsListCm(events);
        refreshEventsListVisibility();
      })
      .catch(function (err) {
        setEventsStatus(
          "Error: " + (err.message || String(err)) + "\nURL: " + url,
          true
        );
        parsedEventsList = [];
        updateEventsTabLabel();
      })
      .finally(function () {
        eventsIndexLoading = false;
        eventsIndexLoaded = true;
        updateEventsTabLabel();
      });
  }

  function fightsUrl(eventIdStr) {
    return (
      "/api/public/events/" + encodeURIComponent(eventIdStr) + "/fights"
    );
  }

  function startingListsPublicPath(numericId) {
    return (
      "/api/events/" +
      encodeURIComponent(numericId) +
      "/starting-lists/public"
    );
  }

  /**
   * MartialMatch public API: GET /api/events/{id}/starting-lists/public
   * Flattens the API JSON into UI rows (cache stores the raw body separately).
   * @param {*} body Parsed JSON
   * @returns {Array<{publicId:string,athleteKey:string,name:string,category:string,categoryParameterId:number|null,academyName:string,academyBranch:string,academyId:number,clubDisplayLine:string,nationality:string,isDisqualifiedForNoPayment:boolean}>}
   */
  function normalizeAthleteKeyPart(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function athleteKeyFromParts(firstName, lastName, academyId) {
    var fn = normalizeAthleteKeyPart(firstName);
    var ln = normalizeAthleteKeyPart(lastName);
    var aid =
      academyId != null && isFinite(Number(academyId))
        ? Math.round(Number(academyId))
        : 0;
    if (!fn && !ln) return "";
    return fn + "|" + ln + "|" + aid;
  }

  function athleteKeyFromEntry(ent) {
    if (!ent) return "";
    if (ent.athleteKey) return ent.athleteKey;
    return athleteKeyFromParts(ent.firstName, ent.lastName, ent.academyId);
  }

  function flattenStartingListFromPublicBody(body) {
    var out = [];
    if (!body || typeof body !== "object") return out;
    var cats = body.categories;
    if (!Array.isArray(cats)) return out;
    for (var ci = 0; ci < cats.length; ci++) {
      var cat = cats[ci];
      if (!cat || typeof cat !== "object") continue;
      var category = String(cat.category != null ? cat.category : "")
        .replace(/\s+/g, " ")
        .trim();
      var pidRaw = cat.parameterId;
      var categoryParameterId =
        pidRaw != null && isFinite(Number(pidRaw))
          ? Number(pidRaw)
          : null;
      var comps = cat.competitors;
      if (!Array.isArray(comps)) continue;
      for (var j = 0; j < comps.length; j++) {
        var row = comps[j];
        if (!row || typeof row !== "object") continue;
        var publicId = row.publicId;
        if (!publicId || typeof publicId !== "string") continue;
        var fn = String(row.firstName != null ? row.firstName : "").trim();
        var ln = String(row.lastName != null ? row.lastName : "").trim();
        var name = (fn + " " + ln).replace(/\s+/g, " ").trim();
        if (!name) name = "—";
        var academyName = String(row.academy != null ? row.academy : "")
          .replace(/\s+/g, " ")
          .trim();
        var academyBranch = String(row.branch != null ? row.branch : "")
          .replace(/\s+/g, " ")
          .trim();
        var aidRaw = row.academyId;
        var academyId =
          aidRaw != null && isFinite(Number(aidRaw))
            ? Math.round(Number(aidRaw))
            : 0;
        var clubDisplayLine =
          formatAcademyClubLine(academyName, academyBranch) || "—";
        var nationality = String(
          row.nationality != null ? row.nationality : ""
        ).trim();
        out.push({
          publicId: publicId,
          athleteKey: athleteKeyFromParts(fn, ln, academyId),
          name: name,
          category: category,
          categoryParameterId: categoryParameterId,
          academyName: academyName || "—",
          academyBranch: academyBranch,
          academyId: academyId,
          clubDisplayLine: clubDisplayLine,
          nationality: nationality,
          isDisqualifiedForNoPayment: Boolean(
            row.isDisqualifiedForNoPayment
          ),
        });
      }
    }
    return out;
  }

  /**
   * @param {string|number} numericId Event API id
   * @returns {Promise<object|null>} Parsed starting-lists/public JSON (full body)
   */
  function fetchStartingListPublicBody(numericId) {
    return fetch(cfg.url(startingListsPublicPath(numericId)), {
      credentials: "omit",
      headers: { Accept: "application/json,*/*" },
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (text) {
        var trimmed = (text || "").trim();
        if (!trimmed) return null;
        try {
          return JSON.parse(trimmed);
        } catch (e) {
          throw new Error("Invalid starting list JSON");
        }
      });
  }

  /**
   * @param {string} paramName
   * @returns {Record<string, true> | null}
   */
  function getPublicIdSetFromUrlParam(paramName) {
    var raw = new URLSearchParams(window.location.search).get(paramName);
    if (raw == null || !String(raw).trim()) return null;
    var parts = String(raw).split(",");
    var map = Object.create(null);
    for (var i = 0; i < parts.length; i++) {
      var id = parts[i].trim();
      if (id) map[id] = true;
    }
    return Object.keys(map).length ? map : null;
  }

  function getEventsFilterIdSetFromUrl() {
    return getPublicIdSetFromUrlParam(URL_PARAM_EVENTS_FILTER);
  }

  function getSlugFilterIdSetFromUrl() {
    return getPublicIdSetFromUrlParam(URL_PARAM_SLUG_FILTER);
  }

  function fightMatchesFilter(row, idSet) {
    if (!idSet) return true;
    var pf = row.publicFight;
    if (!pf) return false;
    var a = pf.firstCompetitor && pf.firstCompetitor.publicId;
    var b = pf.secondCompetitor && pf.secondCompetitor.publicId;
    return Boolean((a && idSet[a]) || (b && idSet[b]));
  }

  function commitSearchParamsAndRefreshFilterUi(p) {
    var qs = p.toString();
    var path = window.location.pathname || "";
    var hash = window.location.hash || "";
    var next = qs ? path + "?" + qs + hash : path + hash;
    window.history.replaceState(null, "", next);
    refreshSlugFromLocation();
    refreshEventsListVisibility();
    updateFilterMainButtonLabel();
  }

  function setEventsFilterQueryInUrl(idsUnique) {
    var p = new URLSearchParams(window.location.search);
    if (!idsUnique.length) {
      p.delete(URL_PARAM_EVENTS_FILTER);
    } else {
      p.set(URL_PARAM_EVENTS_FILTER, idsUnique.join(","));
    }
    commitSearchParamsAndRefreshFilterUi(p);
  }

  function setSlugFilterQueryInUrl(idsUnique) {
    var p = new URLSearchParams(window.location.search);
    if (!idsUnique.length) {
      p.delete(URL_PARAM_SLUG_FILTER);
    } else {
      p.set(URL_PARAM_SLUG_FILTER, idsUnique.join(","));
    }
    commitSearchParamsAndRefreshFilterUi(p);
  }

  function replaceLocationQuery(p) {
    var qs = p.toString();
    var path = window.location.pathname || "";
    var hash = window.location.hash || "";
    var next = qs ? path + "?" + qs + hash : path + hash;
    window.history.replaceState(null, "", next);
    refreshSlugFromLocation();
  }

  function normalizeCmUrlOnLoad() {
    var p = new URLSearchParams(window.location.search);
    var slug = eventSlugFromQuery(p);
    var t = (p.get("tab") || "").toLowerCase();
    var needFix = false;
    if (!slug) {
      if (t !== "events") {
        p.set("tab", "events");
        needFix = true;
      }
    } else {
      if (t !== "events" && t !== "fights" && t !== "harmonogram") {
        p.set("tab", "fights");
        needFix = true;
      }
    }
    if (needFix) replaceLocationQuery(p);
  }

  function getCmTabFromUrl() {
    var p = new URLSearchParams(window.location.search);
    var raw = (p.get("tab") || "").toLowerCase();
    if (raw === "harmonogram") return CM_TAB_HARMONOGRAM;
    if (raw === "events") return CM_TAB_EVENTS;
    if (raw === "fights") return CM_TAB_FIGHTS;
    if (!eventSlugFromQuery(p)) return CM_TAB_EVENTS;
    return CM_TAB_FIGHTS;
  }

  function setCmTabQueryInUrl(tab) {
    var p = new URLSearchParams(window.location.search);
    if (tab === CM_TAB_HARMONOGRAM) {
      p.set("tab", "harmonogram");
    } else if (tab === CM_TAB_EVENTS) {
      p.set("tab", "events");
    } else {
      p.set("tab", "fights");
    }
    replaceLocationQuery(p);
  }

  function replaceSlugInUrl(slugStr, tab) {
    var p = new URLSearchParams(window.location.search);
    var prevParsed = eventSlugFromQuery(p);
    var prevSlug = prevParsed ? prevParsed.slug : "";
    if (slugStr) {
      if (prevSlug !== slugStr) {
        p.delete(URL_PARAM_SLUG_FILTER);
      }
      p.set("slug", slugStr);
    } else {
      p.delete("slug");
      p.delete(URL_PARAM_SLUG_FILTER);
      tab = CM_TAB_EVENTS;
    }
    if (tab === CM_TAB_HARMONOGRAM) p.set("tab", "harmonogram");
    else if (tab === CM_TAB_EVENTS) p.set("tab", "events");
    else p.set("tab", "fights");
    replaceLocationQuery(p);
  }

  function updateCmTabsDisabled() {
    var has = Boolean(evSlug);
    if (tabFightsBtn) {
      tabFightsBtn.disabled = !has;
      tabFightsBtn.classList.toggle("mm-cm-tab--disabled", !has);
      tabFightsBtn.setAttribute("aria-disabled", has ? "false" : "true");
    }
    if (tabHarmonogramBtn) {
      tabHarmonogramBtn.disabled = !has;
      tabHarmonogramBtn.classList.toggle("mm-cm-tab--disabled", !has);
      tabHarmonogramBtn.setAttribute("aria-disabled", has ? "false" : "true");
    }
    updateFightsTabLabel();
    syncFightsWssStatusUi();
  }

  function clearWssFightsRefetchDebounce() {
    if (cmWssFightsRefetchDebounce != null) {
      clearTimeout(cmWssFightsRefetchDebounce);
      cmWssFightsRefetchDebounce = null;
    }
  }

  function scheduleFightsRefetchFromWss() {
    clearWssFightsRefetchDebounce();
    cmWssFightsRefetchDebounce = window.setTimeout(function () {
      cmWssFightsRefetchDebounce = null;
      if (!evSlug || getCmTabFromUrl() !== CM_TAB_FIGHTS) {
        return;
      }
      loadFights().catch(function () {
        /* keep previous list */
      });
    }, 250);
  }

  function syncFightsTabRefreshUi() {
    if (!tabFightsBtn) {
      return;
    }
    var on = fightsLoadInflight > 0;
    if (tabFightsRefreshEl) {
      tabFightsRefreshEl.hidden = !on;
    }
    if (on) {
      tabFightsBtn.setAttribute("aria-busy", "true");
    } else {
      tabFightsBtn.removeAttribute("aria-busy");
    }
  }

  function updateFightsTabLabel() {
    if (!tabFightsBtn) return;
    if (!evSlug || tabFightsBtn.disabled) {
      if (tabFightsLabelEl) tabFightsLabelEl.textContent = "Fights";
      else tabFightsBtn.textContent = "Fights";
      tabFightsBtn.setAttribute("aria-label", "Fights tab");
      return;
    }
    var s = fightsTabStats.shown;
    var t = fightsTabStats.total;
    var slugFilter = getSlugFilterIdSetFromUrl();
    var filtered =
      Boolean(slugFilter && Object.keys(slugFilter).length);
    var body = filtered ? "Fights " + s + "/" + t : "Fights " + t;
    if (tabFightsLabelEl) tabFightsLabelEl.textContent = body;
    else tabFightsBtn.textContent = body;
    var aria = filtered
      ? "Fights tab, " + s + " of " + t + " fights match filter"
      : "Fights tab, " + t + " fights";
    if (fightsLoadInflight > 0) {
      aria += ", loading list";
    }
    tabFightsBtn.setAttribute("aria-label", aria);
  }

  function updateFilterRootVisibility() {
    if (!filterRootEl) return;
    var tab = getCmTabFromUrl();
    var show = tab === CM_TAB_EVENTS || Boolean(evSlug);
    filterRootEl.classList.toggle("is-hidden", !show);
  }

  function updateEventsToolbarUi() {
    if (!eventsToolbarEl || !filterMainBtn) return;
    var tab = getCmTabFromUrl();
    var onEvents = tab === CM_TAB_EVENTS;

    eventsToolbarEl.classList.toggle("is-hidden", !onEvents);
    filterMainBtn.classList.toggle("is-hidden", onEvents);

    if (changeActiveEventBtn) {
      changeActiveEventBtn.classList.add("is-hidden");
    }
    if (filterMainBtnEvents) {
      filterMainBtnEvents.classList.toggle("is-hidden", !onEvents);
    }
  }

  /**
   * Header card is display-only on all tabs (pick another event on Events tab).
   * @param {HTMLElement | null} cardEl
   */
  function wireHeaderCardClearBehavior(cardEl) {
    if (!cardEl) return;
    cardEl.classList.remove("mm-event-row--header-clear-slug");
    cardEl.removeAttribute("role");
    cardEl.removeAttribute("tabindex");
    cardEl.removeAttribute("aria-label");
  }

  function clearActiveEventSlug() {
    if (parsedEventsList.length) {
      activateEventSlug(
        cfg.parseEventSlug(parsedEventsList[0].slug),
        CM_TAB_EVENTS
      );
      return;
    }
    closeFilterPanel();
    var p = new URLSearchParams(window.location.search);
    p.delete("slug");
    p.delete(URL_PARAM_SLUG_FILTER);
    p.set("tab", "events");
    replaceLocationQuery(p);
    lastFightsData = null;
    lastSchedulesPayload = null;
    startingListEntries = null;
    matNamesById = Object.create(null);
    startingListLoadPromise = null;
    if (listEl) listEl.innerHTML = "";
    if (toolbarEl) toolbarEl.classList.add("is-hidden");
    if (placeholderEl) {
      placeholderEl.classList.remove("is-hidden");
      placeholderEl.textContent = "No upcoming events.";
    }
    clearError();
    notifyUrlChanged();
    highlightSelectedEventRow("");
    refreshEventsListVisibility();
    updateFilterMainButtonLabel();
    stopPoll();
  }

  /**
   * Home: reset slug + filters, Events tab, replaceState (no history stack entry).
   * Matches a fresh ?tab=events load: first event is activated when the list exists.
   */
  function goHome() {
    closeFilterPanel();
    var p = new URLSearchParams(window.location.search);
    p.delete("slug");
    p.delete(URL_PARAM_SLUG_FILTER);
    p.delete(URL_PARAM_EVENTS_FILTER);
    p.set("tab", "events");
    replaceLocationQuery(p);

    resetEventApiCacheForHome();
    lastFightsData = null;
    lastSchedulesPayload = null;
    startingListEntries = null;
    matNamesById = Object.create(null);
    startingListLoadPromise = null;
    cmWssInvalidateLiveCacheAndOverlays();
    renderFights(null);
    if (listEl) listEl.innerHTML = "";
    if (toolbarEl) {
      toolbarEl.classList.add("is-hidden");
      toolbarEl.textContent = "";
    }
    refreshHarmonogram();
    clearError();

    if (parsedEventsList.length) {
      activateEventSlug(
        cfg.parseEventSlug(parsedEventsList[0].slug),
        CM_TAB_EVENTS,
        { forceReload: true }
      );
      return;
    }

    notifyUrlChanged();
    applyCmTabDom(CM_TAB_EVENTS);
    highlightSelectedEventRow("");
    refreshEventsListVisibility();
    updateFilterMainButtonLabel();
    stopPoll();
    syncHeaderEventLine();
  }

  var homeNavBtn = document.getElementById("mm-cm-nav-home");
  var helpNavBtn = document.getElementById("mm-cm-nav-help");
  var helpRootEl = document.getElementById("mm-cm-help-root");
  var helpCloseBtn = document.getElementById("mm-cm-help-close");

  function initHomeNav() {
    if (!homeNavBtn) return;
    homeNavBtn.addEventListener("click", function () {
      goHome();
    });
  }

  function openHelpOverlay() {
    if (!helpRootEl) return;
    if (filterPanelOpen) {
      closeFilterPanel();
    }
    helpRootEl.classList.remove("is-hidden");
    helpRootEl.setAttribute("aria-hidden", "false");
    document.body.classList.add("mm-cm-help-open");
    if (helpNavBtn) {
      helpNavBtn.setAttribute("aria-expanded", "true");
    }
    if (helpCloseBtn) {
      helpCloseBtn.focus();
    }
  }

  function closeHelpOverlay() {
    if (!helpRootEl) return;
    helpRootEl.classList.add("is-hidden");
    helpRootEl.setAttribute("aria-hidden", "true");
    document.body.classList.remove("mm-cm-help-open");
    if (helpNavBtn) {
      helpNavBtn.setAttribute("aria-expanded", "false");
      helpNavBtn.focus();
    }
  }

  function initHelpNav() {
    if (!helpNavBtn || !helpRootEl) return;
    helpNavBtn.setAttribute("aria-expanded", "false");
    helpNavBtn.addEventListener("click", function () {
      if (helpRootEl.classList.contains("is-hidden")) {
        openHelpOverlay();
      } else {
        closeHelpOverlay();
      }
    });
    if (helpCloseBtn) {
      helpCloseBtn.addEventListener("click", closeHelpOverlay);
    }
    document.addEventListener("keydown", function (ev) {
      if (
        ev.key === "Escape" &&
        helpRootEl &&
        !helpRootEl.classList.contains("is-hidden")
      ) {
        ev.preventDefault();
        closeHelpOverlay();
      }
    });
  }

  function syncHeaderEventLine() {
    if (origMmLinkEl && typeof cfg.martialMatchEventUrl === "function") {
      if (evSlug) {
        var mmUrl = cfg.martialMatchEventUrl(evSlug.slug);
        var tab = getCmTabFromUrl();
        if (tab === CM_TAB_FIGHTS) {
          mmUrl += "/current-matches";
        } else if (tab === CM_TAB_HARMONOGRAM) {
          mmUrl += "/schedules";
        }
        origMmLinkEl.href = mmUrl;
        origMmLinkEl.setAttribute("title", mmUrl);
        origMmLinkEl.classList.remove("is-hidden");
      } else {
        origMmLinkEl.classList.add("is-hidden");
      }
    }
    if (headerPromptEl && headerCardWrapEl && headerCardRootEl) {
      if (!evSlug) {
        headerCardWrapEl.classList.add("is-hidden");
        headerCardRootEl.innerHTML = "";
        if (eventsIndexLoaded && parsedEventsList.length === 0) {
          headerPromptEl.classList.remove("is-hidden");
          headerPromptEl.textContent = "No upcoming events.";
        } else {
          headerPromptEl.classList.add("is-hidden");
          headerPromptEl.textContent = "";
        }
      } else {
        headerPromptEl.classList.add("is-hidden");
        headerPromptEl.textContent = "";
        headerCardWrapEl.classList.remove("is-hidden");
        headerCardRootEl.innerHTML = "";
        var sum = getEventSummaryForHeader();
        if (sum) {
          headerCardRootEl.appendChild(
            buildEventCardNode(sum, {
              interactive: false,
              headerCompact: true,
            })
          );
          wireHeaderCardClearBehavior(
            headerCardRootEl.querySelector(".mm-event-row")
          );
        }
      }
    }
    if (
      window.MM_PWA &&
      typeof window.MM_PWA.repositionInstallButton === "function"
    ) {
      window.MM_PWA.repositionInstallButton();
    }
  }

  function notifyUrlChanged() {
    refreshSlugFromLocation();
    updateCmTabsDisabled();
    updateFilterRootVisibility();
    syncHeaderEventLine();
    updateEventsToolbarUi();
  }

  function applyCachedEventToView(nid) {
    var c = eventCache[nid];
    if (!c) return;
    lastSchedulesPayload = c.schedulesPayload || null;
    lastFightsData = c.fightsData || null;
    matNamesById = c.matNamesById || Object.create(null);
    startingListEntries =
      c.startingListsPublic != null
        ? flattenStartingListFromPublicBody(c.startingListsPublic)
        : null;
    startingListLoadPromise = null;
  }

  function loadEventBundle(slugObj) {
    var nid = slugObj.numericId;
    var schPath =
      "/api/events/" + encodeURIComponent(nid) + "/schedules";
    var pack = {
      sched: null,
      fd: null,
      startingBody: null,
      errSched: null,
      errFights: null,
      errStart: null,
    };
    return fetchJson(schPath)
      .then(function (sched) {
        pack.sched = sched;
      })
      .catch(function (err) {
        pack.errSched = httpStatusFromFetchError(err);
        pack.sched = null;
      })
      .then(function () {
        return fetchJson(fightsUrl(nid))
          .then(function (fd) {
            pack.fd = fd;
          })
          .catch(function (err) {
            pack.errFights = httpStatusFromFetchError(err);
            pack.fd = null;
          });
      })
      .then(function () {
        var prev = eventCache[nid];
        if (prev && prev.startingListsPublic != null) {
          pack.startingBody = prev.startingListsPublic;
          return;
        }
        return fetchStartingListPublicBody(nid)
          .then(function (body) {
            pack.startingBody = body;
          })
          .catch(function (err) {
            pack.errStart = httpStatusFromFetchError(err);
            pack.startingBody = null;
          });
      })
      .then(function () {
        var prev = eventCache[nid] || {};
        var entriesList =
          pack.errStart != null
            ? []
            : flattenStartingListFromPublicBody(pack.startingBody || null);
        var mats = pack.sched
          ? buildMatMapFromSchedules(pack.sched)
          : prev.matNamesById || Object.create(null);
        var ev = parsedEventsList.filter(function (e) {
          return e.numericId === nid;
        })[0];
        eventCache[nid] = {
          slug: slugObj.slug,
          numericId: nid,
          title: ev ? ev.title || "" : prev.title || "",
          registration: ev ? ev.registration : prev.registration,
          dateText: ev ? ev.dateText || "" : prev.dateText || "",
          place: ev ? ev.place || "" : prev.place || "",
          countryCode: ev ? ev.countryCode || "" : prev.countryCode || "",
          thumb: ev ? ev.thumb || "" : prev.thumb || "",
          tags: ev ? ev.tags || [] : prev.tags || [],
          schedulesPayload: pack.sched,
          fightsData: pack.fd,
          startingListsPublic:
            pack.errStart != null ? null : pack.startingBody,
          matNamesById: mats,
          loaded: true,
          laneStarting:
            pack.errStart != null
              ? laneHttpError(pack.errStart)
              : laneOk(entriesList.length > 0),
          laneSchedules:
            pack.errSched != null
              ? laneHttpError(pack.errSched)
              : laneOk(schedulesPayloadHasData(pack.sched)),
          laneFights:
            pack.errFights != null
              ? laneHttpError(pack.errFights)
              : laneOk(fightsDataHasData(pack.fd)),
        };
        applyCachedEventToView(nid);
        refreshLanesForNumericId(nid);
      });
  }

  function ensureEventLoaded(slugObj, loadOpts) {
    var nid = slugObj.numericId;
    var forceReload = loadOpts && loadOpts.forceReload;
    if (
      !forceReload &&
      eventCache[nid] &&
      eventCache[nid].loaded
    ) {
      applyCachedEventToView(nid);
      return Promise.resolve();
    }
    return loadEventBundle(slugObj);
  }

  function activateEventSlug(slugObj, preferredTab, loadOpts) {
    var tab =
      preferredTab == null ? CM_TAB_EVENTS : preferredTab;
    closeFilterPanel();
    replaceSlugInUrl(slugObj.slug, tab);
    notifyUrlChanged();
    /* Drop previous event's fight count and list until the new bundle resolves. */
    renderFights(null);
    applyCmTabDom(getCmTabFromUrl());
    updateFilterMainButtonLabel();
    refreshEventsListVisibility();
    highlightSelectedEventRow(slugObj.slug);
    if (placeholderEl) {
      placeholderEl.classList.remove("is-hidden");
      placeholderEl.textContent = "Loading…";
    }
    clearError();
    return ensureEventLoaded(slugObj, loadOpts)
      .then(function () {
        syncHeaderEventLine();
        if (placeholderEl) placeholderEl.classList.add("is-hidden");
        clearError();
        if (lastFightsData) {
          renderFights(lastFightsData);
        } else {
          renderFights(null);
        }
        refreshHarmonogram();
        prefetchStartingListEarly();
        updatePollingForTab();
        updateFilterMainButtonLabel();
        refreshEventsListVisibility();
      })
      .catch(function (err) {
        showError(
          "Failed to load event: " +
            (err.message || String(err))
        );
      });
  }

  /** Progress text for loading all events' starting lists belongs on Events tab only. */
  function shouldShowEventsAggregateFilterStatus() {
    return (
      filterPanelOpen &&
      filterPanelStatusEl &&
      getCmTabFromUrl() === CM_TAB_EVENTS
    );
  }

  var AGGREGATE_FILTER_LOAD_HINT =
    "The athlete list and Apply / Clear actions will appear when every event's starting list has finished loading.";

  /**
   * While true, Events-tab aggregate load hides list, search, and apply/clear (see app.css).
   */
  function setEventsAggregateFilterLoadingUi(active) {
    if (filterRootEl) {
      filterRootEl.classList.toggle(
        "mm-cm-filter--aggregate-loading",
        !!active
      );
    }
    if (filterPanelEl) {
      filterPanelEl.setAttribute("aria-busy", active ? "true" : "false");
    }
    if (filterPanelHintEl) {
      filterPanelHintEl.classList.toggle("is-hidden", !active);
      if (active) {
        filterPanelHintEl.textContent = AGGREGATE_FILTER_LOAD_HINT;
      } else {
        filterPanelHintEl.textContent = "";
      }
    }
    if (!active && filterPanelOpen) {
      setFilterMobileBarVisible(true);
    }
    if (active && filterPanelOpen) {
      setFilterMobileBarVisible(false);
    }
  }

  function ensureAggregateParticipantMaps() {
    if (aggregateParticipantMapsPromise) {
      return aggregateParticipantMapsPromise;
    }
    if (!parsedEventsList.length) {
      return Promise.reject(new Error("No event list"));
    }
    function applyStartingListAggregate(ev, body) {
      if (!eventCache[ev.numericId]) {
        eventCache[ev.numericId] = {};
      }
      eventCache[ev.numericId].startingListsPublic = body;
      delete eventCache[ev.numericId].startingListEntries;
      var entries = flattenStartingListFromPublicBody(body || null);
      var map = Object.create(null);
      for (var j = 0; j < entries.length; j++) {
        map[entries[j].publicId] = true;
      }
      eventParticipantIdMap[ev.numericId] = map;
      eventCache[ev.numericId].laneStarting = laneOk(entries.length > 0);
      refreshLanesForNumericId(ev.numericId);
    }
    var list = parsedEventsList;
    var n = list.length;
    var chain = Promise.resolve();
    for (var idx = 0; idx < n; idx++) {
      (function (ev, i) {
        chain = chain.then(function () {
          if (shouldShowEventsAggregateFilterStatus()) {
            filterPanelStatusEl.textContent =
              "Starting lists: " + (i + 1) + " / " + n + "…";
          }
          var cached = eventCache[ev.numericId];
          if (cached && cached.startingListsPublic != null) {
            applyStartingListAggregate(ev, cached.startingListsPublic);
            return Promise.resolve();
          }
          return fetchStartingListPublicBody(ev.numericId)
            .then(function (body) {
              applyStartingListAggregate(ev, body);
            })
            .catch(function (err) {
              eventParticipantIdMap[ev.numericId] = Object.create(null);
              var ex = eventCache[ev.numericId];
              if (ex && ex.loaded) {
                return;
              }
              if (!eventCache[ev.numericId]) {
                eventCache[ev.numericId] = {};
              }
              delete eventCache[ev.numericId].startingListsPublic;
              delete eventCache[ev.numericId].startingListEntries;
              eventCache[ev.numericId].laneStarting = laneHttpError(
                httpStatusFromFetchError(err)
              );
              refreshLanesForNumericId(ev.numericId);
            });
        });
      })(list[idx], idx);
    }
    aggregateParticipantMapsPromise = chain.then(function () {
      if (shouldShowEventsAggregateFilterStatus()) {
        filterPanelStatusEl.textContent = "";
      }
    });
    return aggregateParticipantMapsPromise;
  }

  function buildAggregateFilterEntries() {
    var byPid = Object.create(null);
    var order = [];
    for (var e = 0; e < parsedEventsList.length; e++) {
      var ev = parsedEventsList[e];
      var c = eventCache[ev.numericId];
      if (!c || c.startingListsPublic == null) continue;
      var entList = flattenStartingListFromPublicBody(c.startingListsPublic);
      for (var k = 0; k < entList.length; k++) {
        var ent = entList[k];
        if (!byPid[ent.publicId]) {
          byPid[ent.publicId] = ent;
          order.push(ent.publicId);
        }
      }
    }
    return order.map(function (pid) {
      return byPid[pid];
    });
  }

  function updatePollingForTab() {
    var tab = getCmTabFromUrl();
    if (evSlug && tab === CM_TAB_FIGHTS) {
      startPolling();
    } else {
      stopPoll();
    }
    if (evSlug && cmWssUrlOk()) {
      if (cfg && cfg.wssPreconnect === false) {
        if (getCmTabFromUrl() === CM_TAB_FIGHTS) {
          cmWssConnect();
        }
      } else {
        cmWssConnect();
      }
    }
    syncFightsWssForTab();
    syncFightsWssStatusUi();
  }

  function applyCmTabDom(tab) {
    if (!evSlug && (tab === CM_TAB_FIGHTS || tab === CM_TAB_HARMONOGRAM)) {
      tab = CM_TAB_EVENTS;
    }
    var isE = tab === CM_TAB_EVENTS;
    var isF = tab === CM_TAB_FIGHTS;
    var isH = tab === CM_TAB_HARMONOGRAM;
    if (tabEventsBtn) {
      tabEventsBtn.setAttribute("aria-selected", isE ? "true" : "false");
      tabEventsBtn.tabIndex = isE ? 0 : -1;
    }
    if (tabFightsBtn) {
      tabFightsBtn.setAttribute("aria-selected", isF ? "true" : "false");
      tabFightsBtn.tabIndex = isF ? 0 : -1;
    }
    if (tabHarmonogramBtn) {
      tabHarmonogramBtn.setAttribute("aria-selected", isH ? "true" : "false");
      tabHarmonogramBtn.tabIndex = isH ? 0 : -1;
    }
    if (panelEventsEl) panelEventsEl.hidden = !isE;
    if (panelFightsEl) panelFightsEl.hidden = !isF;
    if (panelHarmonogramEl) panelHarmonogramEl.hidden = !isH;
    if (isH) {
      refreshHarmonogram();
    }
    updatePollingForTab();
    if (window.MM_PWA && typeof window.MM_PWA.notifyTabChange === "function") {
      window.MM_PWA.notifyTabChange(tab);
    }
  }

  function setCmTab(tab) {
    if (!evSlug && (tab === CM_TAB_FIGHTS || tab === CM_TAB_HARMONOGRAM)) {
      tab = CM_TAB_EVENTS;
    }
    closeFilterPanel();
    setCmTabQueryInUrl(tab);
    notifyUrlChanged();
    applyCmTabDom(tab);
    refreshEventsListVisibility();
    updateFilterMainButtonLabel();
  }

  var shareNavBtn = document.getElementById("mm-cm-nav-share");

  function buildSharePayload() {
    var url = window.location.href;
    var title = document.title || "MartialMatch viewer";
    var sum = getEventSummaryForHeader();
    if (sum && sum.title) {
      title = String(sum.title).trim() + " — MartialMatch viewer";
    }
    return { url: url, title: title };
  }

  function copyUrlToClipboard(url) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      return Promise.reject(new Error("clipboard_unavailable"));
    }
    return navigator.clipboard.writeText(url);
  }

  function shareCurrentPageUrl() {
    var payload = buildSharePayload();
    if (navigator.share) {
      if (navigator.canShare && !navigator.canShare(payload)) {
        return copyUrlToClipboard(payload.url);
      }
      return navigator.share(payload).catch(function (err) {
        if (err && err.name === "AbortError") return;
        return copyUrlToClipboard(payload.url);
      });
    }
    return copyUrlToClipboard(payload.url);
  }

  function initShareNav() {
    if (!shareNavBtn) return;
    var canShare = Boolean(navigator.share);
    var canCopy =
      navigator.clipboard && typeof navigator.clipboard.writeText === "function";
    if (!canShare && !canCopy) {
      shareNavBtn.classList.add("is-hidden");
      return;
    }
    shareNavBtn.classList.remove("is-hidden");
    shareNavBtn.addEventListener("click", function () {
      shareCurrentPageUrl().catch(function () {
        /* cancelled or clipboard blocked */
      });
    });
  }

  function initCmTabsFromUrl() {
    if (
      !tabEventsBtn ||
      !tabFightsBtn ||
      !tabHarmonogramBtn ||
      !panelEventsEl ||
      !panelFightsEl ||
      !panelHarmonogramEl
    ) {
      return;
    }
    normalizeCmUrlOnLoad();
    notifyUrlChanged();
    applyCmTabDom(getCmTabFromUrl());
    refreshEventsListVisibility();
    window.addEventListener("popstate", function () {
      refreshSlugFromLocation();
      notifyUrlChanged();
      applyCmTabDom(getCmTabFromUrl());
      refreshHarmonogram();
      if (lastFightsData) renderFights(lastFightsData);
      refreshEventsListVisibility();
      updateFilterMainButtonLabel();
    });
    tabEventsBtn.addEventListener("click", function () {
      setCmTab(CM_TAB_EVENTS);
    });
    tabFightsBtn.addEventListener("click", function () {
      if (!evSlug) return;
      if (getCmTabFromUrl() !== CM_TAB_FIGHTS) {
        setCmTab(CM_TAB_FIGHTS);
      }
      loadFights().catch(function () {
        /* zostaw poprzednią listę */
      });
    });
    tabHarmonogramBtn.addEventListener("click", function () {
      if (!evSlug) return;
      setCmTab(CM_TAB_HARMONOGRAM);
    });
    if (eventsListEl) {
      eventsListEl.addEventListener("click", function (evClick) {
        var t = evClick.target;
        if (!t || !t.closest) return;
        var row = t.closest(".mm-event-row");
        if (!row) return;
        var slugStr = row.getAttribute("data-mm-event-slug");
        if (!slugStr) return;
        var parsed = cfg.parseEventSlug(slugStr);
        if (!parsed) return;
        evClick.preventDefault();
        activateEventSlug(parsed);
      });
      eventsListEl.addEventListener("keydown", function (evKd) {
        if (evKd.key !== "Enter" && evKd.key !== " ") return;
        var row =
          evKd.target && evKd.target.closest
            ? evKd.target.closest(".mm-event-row")
            : null;
        if (!row || !eventsListEl.contains(row)) return;
        evKd.preventDefault();
        var slugStr = row.getAttribute("data-mm-event-slug");
        var parsed = cfg.parseEventSlug(slugStr || "");
        if (parsed) activateEventSlug(parsed);
      });
    }
    var tabsWrap = tabFightsBtn.closest(".mm-cm-tabs");
    if (tabsWrap) {
      tabsWrap.addEventListener("keydown", function (ev) {
        var key = ev.key;
        if (key !== "ArrowLeft" && key !== "ArrowRight") return;
        var cur = getCmTabFromUrl();
        ev.preventDefault();
        if (key === "ArrowRight") {
          if (cur === CM_TAB_EVENTS && evSlug) {
            setCmTab(CM_TAB_FIGHTS);
          } else if (cur === CM_TAB_FIGHTS && evSlug) {
            setCmTab(CM_TAB_HARMONOGRAM);
          }
        } else {
          if (cur === CM_TAB_HARMONOGRAM) {
            setCmTab(CM_TAB_FIGHTS);
          } else if (cur === CM_TAB_FIGHTS) {
            setCmTab(CM_TAB_EVENTS);
          }
        }
        var nt = getCmTabFromUrl();
        var btn =
          nt === CM_TAB_EVENTS
            ? tabEventsBtn
            : nt === CM_TAB_FIGHTS
              ? tabFightsBtn
              : tabHarmonogramBtn;
        if (btn) btn.focus();
      });
    }
  }

  function parseNameSortKeys(fullName) {
    var tokens = String(fullName || "")
      .trim()
      .split(/\s+/);
    var first = tokens[0] || "";
    var last = tokens.length > 1 ? tokens.slice(1).join(" ") : "";
    return { first: first, last: last };
  }

  function compareEntriesByName(a, b) {
    var ka = parseNameSortKeys(a.name);
    var kb = parseNameSortKeys(b.name);
    var c1 = enCollator.compare(ka.first, kb.first);
    if (c1 !== 0) return c1;
    return enCollator.compare(ka.last, kb.last);
  }

  /**
   * Group key: academyId + normalized branch (ASCII, lowercase) when id > 0;
   * else normalized full display line so similar strings merge without id.
   */
  function clubGroupKeyFromEntry(e) {
    var id = e && e.academyId;
    var brNorm = normalizeAcademyBranchForGrouping(e && e.academyBranch);
    if (id != null && id > 0) {
      return "i" + String(id) + ":" + brNorm;
    }
    var line = (e && e.clubDisplayLine) || "—";
    return "n:" + polishAsciiLowerCore(line);
  }

  /** Section title in filter: canonical branch spelling for id>0 groups. */
  function filterClubSectionLabel(entry) {
    if (!entry) return "—";
    if (entry.academyId != null && entry.academyId > 0) {
      var brKey = normalizeAcademyBranchForGrouping(entry.academyBranch);
      var brDisp = titleCaseBranchWordsForDisplay(brKey);
      return formatAcademyClubLine(entry.academyName, brDisp);
    }
    return entry.clubDisplayLine || "—";
  }

  function groupEntriesByClub(entries) {
    /** @type {Record<string, typeof entries>} */
    var byClub = Object.create(null);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var key = clubGroupKeyFromEntry(e);
      if (!byClub[key]) byClub[key] = [];
      byClub[key].push(e);
    }
    var clubKeys = Object.keys(byClub);
    clubKeys.sort(function (a, b) {
      return enCollator.compare(
        filterClubSectionLabel(byClub[a][0]),
        filterClubSectionLabel(byClub[b][0])
      );
    });
    for (var j = 0; j < clubKeys.length; j++) {
      byClub[clubKeys[j]].sort(compareEntriesByName);
    }
    var clubNames = clubKeys.map(function (k) {
      return filterClubSectionLabel(byClub[k][0]);
    });
    return { clubKeys: clubKeys, clubNames: clubNames, byClub: byClub };
  }

  function unbindClubJumpOutside() {
    if (clubJumpOutsideHandler) {
      document.removeEventListener("click", clubJumpOutsideHandler, true);
      clubJumpOutsideHandler = null;
    }
    if (clubJumpEscapeHandler) {
      document.removeEventListener("keydown", clubJumpEscapeHandler, true);
      clubJumpEscapeHandler = null;
    }
  }

  function closeClubJumpDropdown() {
    unbindClubJumpOutside();
    if (filterClubJumpListEl) {
      filterClubJumpListEl.classList.add("is-hidden");
    }
    if (filterClubJumpToggleBtn) {
      filterClubJumpToggleBtn.setAttribute("aria-expanded", "false");
    }
    if (filterClubJumpRootEl) {
      filterClubJumpRootEl.classList.remove("is-open");
    }
  }

  function bindClubJumpOutside() {
    unbindClubJumpOutside();
    clubJumpOutsideHandler = function (ev) {
      var wrap = filterClubJumpWrapEl;
      if (wrap && wrap.contains(ev.target)) return;
      closeClubJumpDropdown();
    };
    clubJumpEscapeHandler = function (ev) {
      if (ev.key === "Escape") {
        closeClubJumpDropdown();
      }
    };
    setTimeout(function () {
      if (clubJumpOutsideHandler) {
        document.addEventListener("click", clubJumpOutsideHandler, true);
      }
      if (clubJumpEscapeHandler) {
        document.addEventListener("keydown", clubJumpEscapeHandler, true);
      }
    }, 0);
  }

  function toggleClubJumpDropdown() {
    if (!filterClubJumpListEl || !filterClubJumpToggleBtn) return;
    var open = filterClubJumpListEl.classList.contains("is-hidden");
    if (open) {
      filterClubJumpListEl.classList.remove("is-hidden");
      filterClubJumpToggleBtn.setAttribute("aria-expanded", "true");
      if (filterClubJumpRootEl) {
        filterClubJumpRootEl.classList.add("is-open");
      }
      bindClubJumpOutside();
    } else {
      closeClubJumpDropdown();
    }
  }

  function hideClubJumpUI() {
    closeClubJumpDropdown();
    if (filterClubJumpWrapEl) {
      filterClubJumpWrapEl.classList.add("is-hidden");
    }
    if (filterClubJumpListEl) {
      filterClubJumpListEl.innerHTML = "";
    }
  }

  function rebuildClubJumpDropdown(clubNames) {
    if (!filterClubJumpWrapEl || !filterClubJumpListEl) return;
    closeClubJumpDropdown();
    filterClubJumpListEl.innerHTML = "";
    var clubCol = document.getElementById("mm-filter-club-jump-club-col");
    filterClubJumpWrapEl.classList.remove("is-hidden");
    if (!clubNames || clubNames.length < 2) {
      if (clubCol) clubCol.classList.add("is-hidden");
      return;
    }
    if (clubCol) clubCol.classList.remove("is-hidden");
    for (var i = 0; i < clubNames.length; i++) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.className = "mm-filter-club-jump__option";
      li.textContent = clubNames[i];
      li.setAttribute("data-sect-index", String(i));
      filterClubJumpListEl.appendChild(li);
    }
  }

  function scrollToFilterClubSection(indexStr) {
    var el = document.getElementById("mm-filter-club-sect-" + indexStr);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function memberFilterCheckboxesInSection(section) {
    if (!section) return [];
    return section.querySelectorAll(
      'input[type="checkbox"][data-mm-filter-member]'
    );
  }

  function clubHeaderCheckboxInSection(section) {
    if (!section) return null;
    return section.querySelector(
      'input[type="checkbox"][data-mm-filter-club]'
    );
  }

  function setClubHeaderCheckboxAria(headerCb) {
    if (!headerCb) return;
    if (headerCb.indeterminate) {
      headerCb.setAttribute("aria-checked", "mixed");
    } else {
      headerCb.setAttribute(
        "aria-checked",
        headerCb.checked ? "true" : "false"
      );
    }
  }

  function updateClubHeaderCheckboxFromMembers(section) {
    var headerCb = clubHeaderCheckboxInSection(section);
    if (!headerCb) return;
    var children = memberFilterCheckboxesInSection(section);
    var n = children.length;
    var checked = 0;
    for (var i = 0; i < n; i++) {
      if (children[i].checked) checked++;
    }
    headerCb.indeterminate = checked > 0 && checked < n;
    headerCb.checked = n > 0 && checked === n;
    setClubHeaderCheckboxAria(headerCb);
  }

  function refreshAllClubHeaderCheckboxes() {
    if (!filterListRootEl) return;
    var sections = filterListRootEl.querySelectorAll(".mm-filter-club");
    for (var s = 0; s < sections.length; s++) {
      updateClubHeaderCheckboxFromMembers(sections[s]);
    }
  }

  function normalizeForFilterSearch(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function applyFilterPanelListVisibility() {
    if (!filterListRootEl) return;
    var queryRaw = filterSearchInputEl ? filterSearchInputEl.value : "";
    var query = String(queryRaw || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    var onlySel = Boolean(filterOnlySelectedCb && filterOnlySelectedCb.checked);
    var onlyFav = Boolean(filterOnlyFavoritesCb && filterOnlyFavoritesCb.checked);

    var anyChecked = false;
    var anyVisible = false;

    var rows = filterListRootEl.querySelectorAll(".mm-filter-row");
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      var mcb = row.querySelector(
        'input[type="checkbox"][data-mm-filter-member]'
      );
      var checked = Boolean(mcb && mcb.checked);
      if (checked) anyChecked = true;

      var hay = row.getAttribute("data-mm-filter-search") || "";
      var searchOk = !query || hay.indexOf(query) !== -1;
      if (searchOk) {
        row.classList.remove(MM_ROW_SEARCH_HIDDEN);
      } else {
        row.classList.add(MM_ROW_SEARCH_HIDDEN);
      }

      var athleteKey = row.getAttribute("data-mm-filter-athlete-key") || "";
      var favOk = !onlyFav || isAthleteKeyFavorite(athleteKey);
      var selOk = !onlySel || checked;
      var viewOk = favOk && selOk;
      if (viewOk) {
        row.classList.remove(MM_ROW_FILTER_HIDDEN);
      } else {
        row.classList.add(MM_ROW_FILTER_HIDDEN);
      }

      if (searchOk && viewOk) {
        anyVisible = true;
      }
    }

    var sections = filterListRootEl.querySelectorAll(".mm-filter-club");
    for (var k = 0; k < sections.length; k++) {
      var sec = sections[k];
      var childRows = sec.querySelectorAll(".mm-filter-row");
      var vis = false;
      for (var c = 0; c < childRows.length; c++) {
        var rr = childRows[c];
        if (
          !rr.classList.contains(MM_ROW_SEARCH_HIDDEN) &&
          !rr.classList.contains(MM_ROW_FILTER_HIDDEN)
        ) {
          vis = true;
          break;
        }
      }
      if (vis) {
        sec.classList.remove(MM_CLUB_FILTER_HIDDEN);
      } else {
        sec.classList.add(MM_CLUB_FILTER_HIDDEN);
      }
    }

    if (filterOnlyEmptyHintEl) {
      if (onlySel && !anyChecked) {
        filterOnlyEmptyHintEl.textContent = "No athletes selected.";
        filterOnlyEmptyHintEl.classList.remove("is-hidden");
      } else if (onlyFav && !anyVisible && !query) {
        if (!filterIdSetKeyCount(loadFavoriteAthleteKeySet())) {
          filterOnlyEmptyHintEl.textContent =
            "No favorites yet — tap ☆ on an athlete.";
        } else {
          filterOnlyEmptyHintEl.textContent =
            "None of your favorites are on this list.";
        }
        filterOnlyEmptyHintEl.classList.remove("is-hidden");
      } else if (query && !anyVisible) {
        filterOnlyEmptyHintEl.textContent =
          "No athletes match search.";
        filterOnlyEmptyHintEl.classList.remove("is-hidden");
      } else {
        filterOnlyEmptyHintEl.textContent = "";
        filterOnlyEmptyHintEl.classList.add("is-hidden");
      }
    }

    syncClubHeaderCheckboxDisabledState(onlyFav, onlySel);
  }

  /** Club select-all is read-only while list shows a subset (favorites / checked). */
  function syncClubHeaderCheckboxDisabledState(onlyFav, onlySel) {
    if (!filterListRootEl) return;
    var lock = Boolean(onlyFav || onlySel);
    var sections = filterListRootEl.querySelectorAll(".mm-filter-club");
    for (var i = 0; i < sections.length; i++) {
      var headerCb = clubHeaderCheckboxInSection(sections[i]);
      if (!headerCb) continue;
      headerCb.disabled = lock;
      var lab = headerCb.closest(".mm-filter-club-name__label");
      if (lab) {
        lab.classList.toggle("mm-filter-club-name__label--club-locked", lock);
      }
    }
  }

  /** @returns {Record<string, true>} */
  function loadFavoriteAthleteKeySet() {
    try {
      var raw = localStorage.getItem(FAVORITES_LS_KEY);
      if (!raw) return Object.create(null);
      var parsed = JSON.parse(raw);
      var keys =
        parsed && Array.isArray(parsed.athleteKeys) ? parsed.athleteKeys : [];
      var out = Object.create(null);
      for (var i = 0; i < keys.length; i++) {
        var k = String(keys[i] || "").trim();
        if (k) out[k] = true;
      }
      return out;
    } catch (err) {
      return Object.create(null);
    }
  }

  function persistFavoriteAthleteKeySet(keySet) {
    var keys = Object.keys(keySet || Object.create(null));
    keys.sort(function (a, b) {
      return enCollator.compare(a, b);
    });
    try {
      localStorage.setItem(
        FAVORITES_LS_KEY,
        JSON.stringify({ v: 1, athleteKeys: keys })
      );
    } catch (err) {
      /* private mode / quota */
    }
  }

  function isAthleteKeyFavorite(athleteKey) {
    if (!athleteKey) return false;
    return Boolean(loadFavoriteAthleteKeySet()[athleteKey]);
  }

  /** @returns {boolean} new favorite state */
  function toggleFavoriteAthleteKey(athleteKey) {
    if (!athleteKey) return false;
    var set = loadFavoriteAthleteKeySet();
    if (set[athleteKey]) {
      delete set[athleteKey];
      persistFavoriteAthleteKeySet(set);
      return false;
    }
    set[athleteKey] = true;
    persistFavoriteAthleteKeySet(set);
    return true;
  }

  function filterIdSetKeyCount(idSet) {
    if (!idSet) return 0;
    return Object.keys(idSet).length;
  }

  function syncFilterFavoriteStarButtonUi(btn, isFavorite) {
    if (!btn) return;
    btn.classList.toggle("is-active", isFavorite);
    btn.setAttribute("aria-pressed", isFavorite ? "true" : "false");
    btn.setAttribute(
      "aria-label",
      isFavorite ? "Remove from favorites" : "Add to favorites"
    );
    var icon = btn.querySelector(".mm-filter-row__favorite-icon");
    if (icon) {
      icon.textContent = isFavorite ? "★" : "☆";
    }
  }

  function makeFilterFavoriteStarButton(publicId, athleteKey, isFavorite) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mm-filter-row__favorite-btn";
    btn.setAttribute("data-mm-filter-favorite", "1");
    btn.setAttribute("data-public-id", publicId);
    btn.setAttribute("data-athlete-key", athleteKey || "");
    btn.innerHTML =
      '<span class="mm-filter-row__favorite-icon" aria-hidden="true">' +
      (isFavorite ? "★" : "☆") +
      "</span>";
    syncFilterFavoriteStarButtonUi(btn, isFavorite);
    return btn;
  }

  function syncAllFavoriteStarsForAthleteKey(athleteKey, isFavorite) {
    if (!filterListRootEl || !athleteKey) return;
    var rows = filterListRootEl.querySelectorAll(".mm-filter-row");
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.getAttribute("data-mm-filter-athlete-key") !== athleteKey) {
        continue;
      }
      var btn = row.querySelector("[data-mm-filter-favorite]");
      syncFilterFavoriteStarButtonUi(btn, isFavorite);
    }
  }

  function onFilterListCheckboxChange(ev) {
    var t = ev.target;
    if (!t || t.type !== "checkbox" || !filterListRootEl) return;
    if (!filterListRootEl.contains(t)) return;
    var section = t.closest(".mm-filter-club");
    if (!section) return;

    if (t.hasAttribute("data-mm-filter-club")) {
      if (t.disabled) return;
      t.indeterminate = false;
      var kids = memberFilterCheckboxesInSection(section);
      for (var i = 0; i < kids.length; i++) {
        kids[i].checked = t.checked;
      }
      setClubHeaderCheckboxAria(t);
      applyFilterPanelListVisibility();
      return;
    }

    if (t.hasAttribute("data-mm-filter-member")) {
      updateClubHeaderCheckboxFromMembers(section);
      applyFilterPanelListVisibility();
    }
  }

  function onFilterFavoriteStarClick(ev) {
    var t = ev.target;
    if (!t || !t.closest || !filterListRootEl) return;
    var btn = t.closest("[data-mm-filter-favorite]");
    if (!btn || !filterListRootEl.contains(btn)) return;
    ev.preventDefault();
    var athleteKey = btn.getAttribute("data-athlete-key");
    if (!athleteKey) return;
    var nowFav = toggleFavoriteAthleteKey(athleteKey);
    syncAllFavoriteStarsForAthleteKey(athleteKey, nowFav);
    applyFilterPanelListVisibility();
  }

  function onFilterOnlyFavoritesChange() {
    if (
      filterOnlyFavoritesCb &&
      filterOnlyFavoritesCb.checked &&
      filterOnlySelectedCb
    ) {
      filterOnlySelectedCb.checked = false;
    }
    applyFilterPanelListVisibility();
  }

  function onFilterOnlySelectedChange() {
    if (
      filterOnlySelectedCb &&
      filterOnlySelectedCb.checked &&
      filterOnlyFavoritesCb
    ) {
      filterOnlyFavoritesCb.checked = false;
    }
    applyFilterPanelListVisibility();
  }

  function makeFilterDqNoPaymentIcon(ariaLabel, extraClass) {
    var el = document.createElement("span");
    el.className =
      "mm-filter-row__dq-icon" + (extraClass ? " " + extraClass : "");
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", ariaLabel);
    el.innerHTML =
      '<svg class="mm-filter-row__dq-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" focusable="false" aria-hidden="true">' +
      '<path fill="#ebc53d" d="M12 2.2 21.5 20.5H2.5L12 2.2z"/>' +
      '<path fill="#1a1d26" d="M11 9.2h2v5h-2v-5zm0 6.3h2v2.3h-2v-2.3z"/>' +
      "</svg>";
    return el;
  }

  function renderFilterListDom(entries) {
    if (!filterListRootEl) return;
    filterListRootEl.innerHTML = "";
    var grouped = groupEntriesByClub(entries);
    for (var c = 0; c < grouped.clubKeys.length; c++) {
      var clubKey = grouped.clubKeys[c];
      var clubName = grouped.clubNames[c];
      var list = grouped.byClub[clubKey];

      var section = document.createElement("section");
      section.className = "mm-filter-club";
      section.id = "mm-filter-club-sect-" + c;

      var hn = document.createElement("h3");
      hn.className = "mm-filter-club-name mm-filter-club-name--with-select";
      var lab = document.createElement("label");
      lab.className = "mm-filter-club-name__label";

      var checkWrapClub = document.createElement("span");
      checkWrapClub.className = "mm-filter-club-name__check-wrap";
      var clubCb = document.createElement("input");
      clubCb.type = "checkbox";
      clubCb.setAttribute("data-mm-filter-club", "1");
      clubCb.setAttribute(
        "aria-label",
        "Select or clear all in: " + clubName
      );
      clubCb.setAttribute("aria-checked", "false");
      checkWrapClub.appendChild(clubCb);

      var titleSpan = document.createElement("span");
      titleSpan.className = "mm-filter-club-name__title";
      titleSpan.textContent = clubName;

      lab.appendChild(checkWrapClub);
      lab.appendChild(titleSpan);
      hn.appendChild(lab);
      section.appendChild(hn);
      for (var r = 0; r < list.length; r++) {
        var item = list[r];
        var dqNoPay = Boolean(item.isDisqualifiedForNoPayment);
        var row = document.createElement("div");
        row.className = "mm-filter-row";
        row.setAttribute("data-mm-filter-public-id", item.publicId);
        row.setAttribute(
          "data-mm-filter-athlete-key",
          item.athleteKey || athleteKeyFromEntry(item)
        );
        row.setAttribute(
          "data-mm-filter-search",
          normalizeForFilterSearch(
            item.name +
              " " +
              (item.clubDisplayLine || "") +
              (dqNoPay ? " disqualified no payment" : "")
          )
        );

        var textWrap = document.createElement("div");
        textWrap.className = "mm-filter-row__text";

        var nameEl = document.createElement("div");
        nameEl.className = "mm-filter-row__name";
        nameEl.textContent = displayNameWithFamilyEmoji(item.name);
        if (dqNoPay) {
          nameEl.setAttribute(
            "title",
            "Not paid yet — may be disqualified until fee is cleared; still selectable in filter."
          );
        }

        textWrap.appendChild(nameEl);
        if (item.category) {
          var metaEl = document.createElement("div");
          metaEl.className = "mm-filter-row__meta";
          metaEl.textContent = item.category;
          textWrap.appendChild(metaEl);
        }

        var controlsWrap = document.createElement("div");
        controlsWrap.className = "mm-filter-row__controls";
        controlsWrap.appendChild(
          makeFilterFavoriteStarButton(
            item.publicId,
            item.athleteKey || athleteKeyFromEntry(item),
            isAthleteKeyFavorite(item.athleteKey || athleteKeyFromEntry(item))
          )
        );

        var checkWrap = document.createElement("div");
        checkWrap.className = "mm-filter-row__check";
        if (dqNoPay) {
          var checkWithDq = document.createElement("div");
          checkWithDq.className = "mm-filter-row__check-with-dq";
          checkWithDq.appendChild(
            makeFilterDqNoPaymentIcon(
              "Not paid yet — still selectable in filter",
              "mm-filter-row__dq-icon--selectable"
            )
          );
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.value = item.publicId;
          cb.setAttribute("data-mm-filter", "1");
          cb.setAttribute("data-mm-filter-member", "1");
          checkWithDq.appendChild(cb);
          checkWrap.appendChild(checkWithDq);
        } else {
          var cbPlain = document.createElement("input");
          cbPlain.type = "checkbox";
          cbPlain.value = item.publicId;
          cbPlain.setAttribute("data-mm-filter", "1");
          cbPlain.setAttribute("data-mm-filter-member", "1");
          checkWrap.appendChild(cbPlain);
        }
        controlsWrap.appendChild(checkWrap);

        row.appendChild(textWrap);
        row.appendChild(controlsWrap);
        section.appendChild(row);
      }

      filterListRootEl.appendChild(section);
    }
    rebuildClubJumpDropdown(grouped.clubNames);
    if (filterOnlySelectedCb) {
      filterOnlySelectedCb.checked = false;
    }
    if (filterOnlyFavoritesCb) {
      filterOnlyFavoritesCb.checked = false;
    }
    if (filterSearchInputEl) {
      filterSearchInputEl.value = "";
    }
    applyFilterPanelListVisibility();
  }

  function syncFilterCheckboxesFromUrl() {
    if (!filterListRootEl) return;
    var idSet =
      getCmTabFromUrl() === CM_TAB_EVENTS
        ? getEventsFilterIdSetFromUrl()
        : getSlugFilterIdSetFromUrl();
    var boxes = filterListRootEl.querySelectorAll(
      'input[type="checkbox"][data-mm-filter-member]'
    );
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      b.checked = Boolean(idSet && idSet[b.value]);
    }
    refreshAllClubHeaderCheckboxes();
    applyFilterPanelListVisibility();
  }

  function countEventsFilterIdsInUrl() {
    var idSet = getEventsFilterIdSetFromUrl();
    if (!idSet) return 0;
    return Object.keys(idSet).length;
  }

  function countSlugFilterIdsInUrl() {
    var idSet = getSlugFilterIdSetFromUrl();
    if (!idSet) return 0;
    return Object.keys(idSet).length;
  }

  /**
   * PublicId lookup for the active event (walki / harmonogram context).
   * @returns {Record<string, true> | null}
   */
  function buildActiveEventPublicIdLookup() {
    if (!eventNumericId) return null;
    var nid = eventNumericId;
    var c = eventCache[nid];
    var entries = null;
    if (c && c.startingListsPublic != null) {
      entries = flattenStartingListFromPublicBody(c.startingListsPublic);
    } else if (
      evSlug &&
      String(evSlug.numericId) === String(nid) &&
      Array.isArray(startingListEntries)
    ) {
      entries = startingListEntries;
    }
    if (entries) {
      var out = Object.create(null);
      for (var i = 0; i < entries.length; i++) {
        out[entries[i].publicId] = true;
      }
      return out;
    }
    var pm = eventParticipantIdMap[nid];
    if (pm && typeof pm === "object") return pm;
    return null;
  }

  /**
   * On Events tab: all IDs in URL. On Fights/Schedule: IDs in URL that
   * appear on the current event's starting list.
   */
  function countFilterIdsForMainButton() {
    var tab = getCmTabFromUrl();
    if (tab === CM_TAB_EVENTS) {
      var es = getEventsFilterIdSetFromUrl();
      return es ? Object.keys(es).length : 0;
    }
    var idSet = getSlugFilterIdSetFromUrl();
    if (!idSet) return 0;
    var inEvent = buildActiveEventPublicIdLookup();
    if (!inEvent) return 0;
    var n = 0;
    for (var k in idSet) {
      if (inEvent[k]) n++;
    }
    return n;
  }

  function filterMainBtnLabelByParticipantCount(n) {
    return n === 1 ? "1 participant" : n + " participants";
  }

  function filterMainBtnLabelEvents(totalSelected) {
    if (!totalSelected) return "Filter events by participants";
    return (
      "Filtered events by " + filterMainBtnLabelByParticipantCount(totalSelected)
    );
  }

  function filterMainBtnLabelSlugTab(tab, selectedOnEvent, totalUrlSlug) {
    var kind = tab === CM_TAB_HARMONOGRAM ? "schedule" : "fights";
    if (!totalUrlSlug) return "Filter " + kind + " by participants";
    return (
      "Filtered " +
      kind +
      " by " +
      filterMainBtnLabelByParticipantCount(selectedOnEvent)
    );
  }

  /** Athletes on the active event starting list (denominator for filter button). */
  function countStartingListSizeActiveEvent() {
    if (!eventNumericId) return 0;
    var c = eventCache[eventNumericId];
    if (c && c.startingListsPublic != null) {
      return flattenStartingListFromPublicBody(c.startingListsPublic).length;
    }
    if (
      evSlug &&
      String(evSlug.numericId) === String(eventNumericId) &&
      Array.isArray(startingListEntries)
    ) {
      return startingListEntries.length;
    }
    return 0;
  }

  function updateFilterMainButtonLabel() {
    var triggers = [filterMainBtn, filterMainBtnEvents].filter(Boolean);
    if (!triggers.length) return;

    var n = countFilterIdsForMainButton();
    var tab = getCmTabFromUrl();
    var totalUrlEvents = countEventsFilterIdsInUrl();
    var totalUrlSlug = countSlugFilterIdsInUrl();
    var poolActive = countStartingListSizeActiveEvent();

    for (var ti = 0; ti < triggers.length; ti++) {
      var btn = triggers[ti];
      var lab = btn.querySelector(".mm-filter-main-btn__label");
      btn.setAttribute("aria-expanded", filterPanelOpen ? "true" : "false");
      if (filterPanelOpen) {
        if (lab) lab.textContent = "Hide Filter";
        btn.setAttribute(
          "aria-label",
          "Hide Filter — collapse panel without applying; use Apply Filter to save."
        );
        btn.title =
          "Hide Filter: closes without saving. List and schedule stay as after last Apply Filter.";
        continue;
      }
      if (lab) {
        if (btn === filterMainBtnEvents && tab === CM_TAB_EVENTS) {
          lab.textContent = filterMainBtnLabelEvents(totalUrlEvents);
        } else if (btn === filterMainBtn && tab !== CM_TAB_EVENTS) {
          lab.textContent = filterMainBtnLabelSlugTab(tab, n, totalUrlSlug);
        }
      }
      if (tab === CM_TAB_EVENTS) {
        if (btn !== filterMainBtnEvents) continue;
        btn.setAttribute(
          "aria-label",
          n > 0
            ? "Open filter — URL has " +
              n +
              " participant(s) selected (all events)."
            : "Open filter — none selected in URL; all participants shown."
        );
        btn.title =
          n > 0
            ? "URL has " +
              n +
              " participant(s) across all events. Click to edit."
            : "No filter in URL — all visible. Click to pick participants.";
      } else {
        if (btn !== filterMainBtn) continue;
        btn.setAttribute(
          "aria-label",
          n > 0
            ? poolActive > 0
              ? "Open filter — for this event, " +
                n +
                " of " +
                poolActive +
                " athletes on the starting list."
              : "Open filter — for this event, " +
                n +
                " participant(s) from URL match the starting list."
            : totalUrlSlug > 0
              ? "Open filter — URL has " +
                totalUrlSlug +
                " participant(s), none on this event's list."
              : "Open filter — none in URL; all participants shown."
        );
        btn.title =
          n > 0
            ? poolActive > 0
              ? "For this event, " +
                n +
                " of " +
                poolActive +
                " on the starting list. Click to edit."
              : "For this event, " +
                n +
                " participant(s) from URL match the starting list. Click to edit."
            : totalUrlSlug > 0
              ? "URL has " +
                totalUrlSlug +
                " participant(s), but none are on this event's list."
              : "No filter in URL — all visible. Click to pick participants.";
      }
    }
  }

  function setFilterMobileBarVisible(visible) {
    if (!filterMobileBarEl) return;
    if (visible) {
      filterMobileBarEl.classList.remove("is-hidden");
      filterMobileBarEl.setAttribute("aria-hidden", "false");
    } else {
      filterMobileBarEl.classList.add("is-hidden");
      filterMobileBarEl.setAttribute("aria-hidden", "true");
    }
  }

  function openFilterPanel() {
    filterPanelOpen = true;
    if (filterRootEl) {
      filterRootEl.classList.add("is-open");
    }
    if (filterPanelEl) {
      filterPanelEl.classList.remove("is-hidden");
      filterPanelEl.setAttribute("aria-hidden", "false");
    }
    setFilterMobileBarVisible(true);
    updateFilterMainButtonLabel();
  }

  function closeFilterPanel() {
    filterPanelOpen = false;
    setEventsAggregateFilterLoadingUi(false);
    closeClubJumpDropdown();
    setFilterMobileBarVisible(false);
    if (filterRootEl) {
      filterRootEl.classList.remove("is-open");
    }
    if (filterPanelEl) {
      filterPanelEl.classList.add("is-hidden");
      filterPanelEl.setAttribute("aria-hidden", "true");
    }
    if (filterPanelStatusEl) filterPanelStatusEl.textContent = "";
    updateFilterMainButtonLabel();
  }

  function collectCheckedPublicIds() {
    if (!filterListRootEl) return [];
    var boxes = filterListRootEl.querySelectorAll(
      'input[type="checkbox"][data-mm-filter-member]:checked'
    );
    var seen = Object.create(null);
    var order = [];
    for (var i = 0; i < boxes.length; i++) {
      var v = boxes[i].value;
      if (v && !seen[v]) {
        seen[v] = true;
        order.push(v);
      }
    }
    return order;
  }

  function closeFilterPanelAndRefreshViews(tab) {
    closeFilterPanel();
    if (tab === CM_TAB_EVENTS) {
      refreshEventsListVisibility();
    } else {
      if (tab === CM_TAB_FIGHTS) {
        /**
         * Filter apply can radically change visible rows. Drop live WSS cache to avoid
         * briefly reapplying stale mat+fight overlays during list rebuild.
         */
        cmWssInvalidateLiveCacheAndOverlays();
      }
      if (lastFightsData) {
        renderFights(lastFightsData);
      }
      refreshHarmonogram();
    }
  }

  function applyFilterFromPanel() {
    var tab = getCmTabFromUrl();
    var ids = collectCheckedPublicIds();
    if (tab === CM_TAB_EVENTS) {
      setEventsFilterQueryInUrl(ids);
    } else {
      setSlugFilterQueryInUrl(ids);
    }
    closeFilterPanelAndRefreshViews(tab);
  }

  /**
   * Clear filter URL for current tab (fights: only removes IDs on this event's list
   * when applicable), sync checkboxes, close panel — same outcome as Apply with none selected.
   */
  function applyFilterClearFromPanel() {
    var tab = getCmTabFromUrl();
    if (
      (tab === CM_TAB_FIGHTS || tab === CM_TAB_HARMONOGRAM) &&
      evSlug &&
      startingListEntries &&
      startingListEntries.length
    ) {
      var inEvent = Object.create(null);
      for (var ci = 0; ci < startingListEntries.length; ci++) {
        inEvent[startingListEntries[ci].publicId] = true;
      }
      var urlSet = getSlugFilterIdSetFromUrl();
      if (urlSet) {
        var remaining = [];
        for (var k in urlSet) {
          if (!inEvent[k]) remaining.push(k);
        }
        setSlugFilterQueryInUrl(remaining);
      } else {
        setSlugFilterQueryInUrl([]);
      }
    } else if (tab === CM_TAB_EVENTS) {
      setEventsFilterQueryInUrl([]);
    } else {
      setSlugFilterQueryInUrl([]);
    }
    syncFilterCheckboxesFromUrl();
    closeFilterPanelAndRefreshViews(tab);
  }

  function fetchHtml(path) {
    return fetch(cfg.url(path), {
      credentials: "omit",
      headers: { Accept: "text/html,*/*" },
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    });
  }

  function ensureStartingListLoaded() {
    if (!evSlug) {
      return Promise.reject(new Error("Missing slug"));
    }
    var nid = evSlug.numericId;
    if (eventCache[nid] && eventCache[nid].startingListsPublic != null) {
      startingListEntries = flattenStartingListFromPublicBody(
        eventCache[nid].startingListsPublic
      );
      refreshHarmonogram();
      return Promise.resolve(startingListEntries);
    }
    if (
      String(eventNumericId) === String(nid) &&
      Array.isArray(startingListEntries)
    ) {
      return Promise.resolve(startingListEntries);
    }
    if (startingListLoadPromise) {
      if (
        filterPanelOpen &&
        filterPanelStatusEl &&
        getCmTabFromUrl() !== CM_TAB_EVENTS
      ) {
        filterPanelStatusEl.textContent = "Loading starting lists…";
      }
      return startingListLoadPromise;
    }
    if (
      filterPanelOpen &&
      filterPanelStatusEl &&
      getCmTabFromUrl() !== CM_TAB_EVENTS
    ) {
      filterPanelStatusEl.textContent = "Loading starting lists…";
    }
    startingListLoadPromise = fetchStartingListPublicBody(nid)
      .then(function (body) {
        startingListLoadPromise = null;
        if (!eventCache[nid]) eventCache[nid] = {};
        eventCache[nid].startingListsPublic = body;
        delete eventCache[nid].startingListEntries;
        var entries = flattenStartingListFromPublicBody(body || null);
        eventCache[nid].laneStarting = laneOk(entries.length > 0);
        refreshLanesForNumericId(nid);
        startingListEntries = entries;
        refreshHarmonogram();
        return entries;
      })
      .catch(function (err) {
        startingListLoadPromise = null;
        startingListEntries = null;
        if (!eventCache[nid]) eventCache[nid] = {};
        delete eventCache[nid].startingListsPublic;
        delete eventCache[nid].startingListEntries;
        eventCache[nid].laneStarting = laneHttpError(
          httpStatusFromFetchError(err)
        );
        refreshLanesForNumericId(nid);
        refreshHarmonogram();
        throw err;
      });
    return startingListLoadPromise;
  }

  function onFilterPanelOpenRequest() {
    if (getCmTabFromUrl() === CM_TAB_EVENTS) {
      if (filterListRootEl) filterListRootEl.innerHTML = "";
      hideClubJumpUI();
      setEventsAggregateFilterLoadingUi(true);
      if (filterPanelStatusEl) {
        filterPanelStatusEl.textContent = "Loading all lists…";
      }
      ensureAggregateParticipantMaps()
        .then(function () {
          setEventsAggregateFilterLoadingUi(false);
          if (filterPanelStatusEl) filterPanelStatusEl.textContent = "";
          var merged = buildAggregateFilterEntries();
          if (!merged.length) {
            throw new Error("No athletes in lists");
          }
          renderFilterListDom(merged);
          syncFilterCheckboxesFromUrl();
        })
        .catch(function (err) {
          setEventsAggregateFilterLoadingUi(false);
          if (filterPanelStatusEl) {
            filterPanelStatusEl.textContent =
              "Failed to load lists: " +
              (err.message || String(err));
          }
          if (filterListRootEl) filterListRootEl.innerHTML = "";
          hideClubJumpUI();
        });
      return;
    }
    ensureStartingListLoaded()
      .then(function (entries) {
        if (filterPanelStatusEl) {
          filterPanelStatusEl.textContent = entries.length
            ? ""
            : "No athletes on the starting list.";
        }
        renderFilterListDom(entries);
        syncFilterCheckboxesFromUrl();
      })
      .catch(function (err) {
        if (filterPanelStatusEl) {
          filterPanelStatusEl.textContent =
            "Failed to load lists: " +
            (err.message || String(err));
        }
        if (filterListRootEl) filterListRootEl.innerHTML = "";
        hideClubJumpUI();
      });
  }

  function onFilterMainButtonClick() {
    if (!filterPanelOpen) {
      openFilterPanel();
      onFilterPanelOpenRequest();
      return;
    }
    closeFilterPanel();
  }

  function prefetchStartingListEarly() {
    if (!evSlug) return;
    ensureStartingListLoaded().catch(function () {
      /* prefetch w tle — błąd pokażemy przy otwarciu panelu */
    });
  }

  function showError(msg) {
    if (placeholderEl) placeholderEl.classList.add("is-hidden");
    if (toolbarEl) toolbarEl.classList.add("is-hidden");
    if (listEl) listEl.innerHTML = "";
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove("is-hidden");
    }
  }

  function clearError() {
    if (errEl) {
      errEl.textContent = "";
      errEl.classList.add("is-hidden");
    }
  }

  function stopPoll() {
    fightsPollingActive = false;
    clearWssFightsRefetchDebounce();
    if (pollTimerId !== null) {
      clearInterval(pollTimerId);
      pollTimerId = null;
    }
    updateFightsTabLabel();
  }

  function renderFights(data) {
    if (!listEl) return;

    lastFightsData = data;
    listEl.innerHTML = "";

    var idSet = getSlugFilterIdSetFromUrl();
    var queue = (data && data.fightQueueStatuses) || {};
    var allRows = (
      data && data.result && Array.isArray(data.result) ? data.result : []
    ).slice();
    allRows.sort(function (a, b) {
      return (
        sortKeyStartTime(a.startTime) - sortKeyStartTime(b.startTime)
      );
    });

    if (!allRows.length) {
      cmWssLiveMsgByChannel = Object.create(null);
      cmWssDedupByChannel = Object.create(null);
      cmWssLastByChannel = Object.create(null);
      var emptyF = document.createElement("p");
      emptyF.className = "mm-muted";
      emptyF.textContent = MSG_FIGHTS_NOT_READY;
      listEl.appendChild(emptyF);
      fightsTabStats.shown = 0;
      fightsTabStats.total = 0;
      updateFightsTabLabel();
      if (evSlug && getCmTabFromUrl() === CM_TAB_FIGHTS && cmWssUrlOk()) {
        cmWssResyncSubscriptionFromFights();
      }
      if (toolbarEl) {
        toolbarEl.classList.add("is-hidden");
        toolbarEl.textContent = "";
      }
      return;
    }

    var rows = allRows.filter(function (row) {
      return fightMatchesFilter(row, idSet);
    });

    pruneCmWssLiveCacheForRenderedFights(rows);
    cmWssDedupByChannel = Object.create(null);
    cmWssLastByChannel = Object.create(null);

    rows.forEach(function (row, idx) {
      var pf = row.publicFight;
      if (!pf) return;
      var fightId = pf.id;
      var matId = pf.matId;
      var variant = rowHeadVariant(fightId, matId, queue);
      var matNameRaw = matNamesById[String(matId)] || "Mata " + matId;
      var matNameDisplay = buildMatDisplayName(matNameRaw, matId);

      var article = document.createElement("article");
      article.className = "mm-fight";
      article.setAttribute("data-mm-mat-id", String(matId));
      article.setAttribute("data-mm-fight-id", String(fightId));

      var topbar = document.createElement("div");
      topbar.className =
        "mm-fight__topbar mm-fight__topbar--" + variant;

      var row1 = document.createElement("div");
      row1.className = "mm-fight__topbar-row1";

      var mid = document.createElement("div");
      mid.className = "mm-fight__topbar-mid";

      var num = pf.fightNumber != null ? pf.fightNumber : idx + 1;
      var hash = document.createElement("span");
      hash.className = "mm-fight__fight-num";
      hash.textContent = "#" + num;
      mid.appendChild(hash);

      var t = parseStartTimeUtc(row.startTime);
      var timeSpan = document.createElement("span");
      timeSpan.className = "mm-fight__top-time";
      timeSpan.textContent =
        t && !isNaN(t.getTime()) ? timeFmt.format(t) : "—";
      mid.appendChild(timeSpan);

      var bt = Number(pf.bracketType);
      if (bt === MM_BRACKET_TYPE_THREE_COMPETITOR_REPECHAGE) {
        var tcrBadge = document.createElement("span");
        tcrBadge.className = "mm-fight__rb mm-fight__rb--3cr";
        tcrBadge.textContent = "3CR";
        tcrBadge.setAttribute("title", "Three-competitor repechage");
        mid.appendChild(tcrBadge);
      }
      if (bt === MM_BRACKET_TYPE_ROUND_ROBIN) {
        var rrBadge = document.createElement("span");
        rrBadge.className = "mm-fight__rb mm-fight__rb--rr";
        rrBadge.textContent = "RR";
        rrBadge.setAttribute("title", "Round robin");
        mid.appendChild(rrBadge);
      }

      roundBadgeList(pf).forEach(function (b) {
        var badge = document.createElement("span");
        badge.className =
          "mm-fight__rb mm-fight__rb--" + b.variant;
        badge.textContent = b.text;
        mid.appendChild(badge);
      });

      var wssCell = document.createElement("div");
      wssCell.className = "mm-fight__topbar-wss";
      var wssRace = document.createElement("div");
      wssRace.className = "mm-fight__wss-race";
      wssRace.setAttribute("hidden", "hidden");
      wssRace.setAttribute("aria-label", "Round time remaining");
      wssRace.innerHTML = WSS_CHEQUERED_FLAG_SVG + '<span class="mm-fight__wss-timer"></span>';
      wssCell.appendChild(wssRace);

      var right = document.createElement("div");
      right.className = "mm-fight__topbar-right";
      right.innerHTML = MAT_PIN_SVG;
      var matSpan = document.createElement("span");
      matSpan.className = "mm-fight__mat-label";
      matSpan.textContent = matNameDisplay;
      right.appendChild(matSpan);

      row1.appendChild(mid);
      row1.appendChild(wssCell);
      row1.appendChild(right);
      topbar.appendChild(row1);

      var cat = pf.category ? String(pf.category).trim() : "";
      if (cat) {
        var row2 = document.createElement("div");
        row2.className = "mm-fight__topbar-row2";
        var catEl = document.createElement("div");
        catEl.className = "mm-fight__top-category";
        catEl.textContent = cat;
        row2.appendChild(catEl);
        topbar.appendChild(row2);
      }

      var body = document.createElement("div");
      body.className = "mm-fight__body";
      var cornerMap = resolveCornerMapping(
        pf.scoreboardType,
        Boolean(pf.switchedCompetitors)
      );
      var blueCompetitor =
        cornerMap.blueParticipantKey === "first"
          ? pf.firstCompetitor
          : pf.secondCompetitor;
      var redCompetitor =
        cornerMap.redParticipantKey === "first"
          ? pf.firstCompetitor
          : pf.secondCompetitor;
      var blueTopLayout = isBlueFirstScoreboardType(pf.scoreboardType);
      if (blueTopLayout) {
        body.appendChild(buildAthleteRow(blueCompetitor, "blue"));
        body.appendChild(buildAthleteRow(redCompetitor, "red"));
      } else {
        body.appendChild(buildAthleteRow(redCompetitor, "red"));
        body.appendChild(buildAthleteRow(blueCompetitor, "blue"));
      }

      article.appendChild(topbar);
      article.appendChild(body);
      listEl.appendChild(article);
    });

    fightsTabStats.shown = rows.length;
    fightsTabStats.total = allRows.length;
    updateFightsTabLabel();
    if (evSlug && getCmTabFromUrl() === CM_TAB_FIGHTS && cmWssUrlOk()) {
      cmWssConnect();
      cmWssResyncSubscriptionFromFights();
    }
    reapplyCachedWssLiveToFightRows();
    if (toolbarEl) {
      toolbarEl.classList.add("is-hidden");
      toolbarEl.textContent = "";
    }
  }

  function fetchJson(path) {
    return fetch(cfg.url(path), {
      credentials: "omit",
      headers: { Accept: "application/json" },
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function loadFights() {
    fightsLoadInflight++;
    syncFightsTabRefreshUi();
    updateFightsTabLabel();
    return fetchJson(fightsUrl(eventNumericId))
      .then(function (data) {
        clearError();
        renderFights(data);
        if (eventNumericId && eventCache[eventNumericId]) {
          var c = eventCache[eventNumericId];
          c.fightsData = data;
          if (c.laneFights != null) {
            c.laneFights = laneOk(fightsDataHasData(data));
            refreshLanesForNumericId(eventNumericId);
          }
        }
      })
      .catch(function (err) {
        if (eventNumericId && eventCache[eventNumericId]) {
          var c2 = eventCache[eventNumericId];
          if (c2.laneFights != null) {
            c2.laneFights = laneHttpError(httpStatusFromFetchError(err));
            refreshLanesForNumericId(eventNumericId);
          }
        }
        throw err;
      })
      .finally(function () {
        fightsLoadInflight = Math.max(0, fightsLoadInflight - 1);
        syncFightsTabRefreshUi();
        updateFightsTabLabel();
      });
  }

  function startPolling() {
    stopPoll();
    fightsPollingActive = true;
    var ms = cfg.currentMatchesRefreshMs || 30000;
    pollTimerId = window.setInterval(function () {
      loadFights().catch(function () {
        /* zostaw poprzednią listę */
      });
    }, ms);
    updateFightsTabLabel();
  }

  if (filterMainBtn) {
    filterMainBtn.addEventListener("click", onFilterMainButtonClick);
  }
  if (filterMainBtnEvents) {
    filterMainBtnEvents.addEventListener("click", onFilterMainButtonClick);
  }
  if (changeActiveEventBtn) {
    changeActiveEventBtn.addEventListener("click", function () {
      clearActiveEventSlug();
    });
  }
  if (filterApplyStickyBtn) {
    filterApplyStickyBtn.addEventListener("click", applyFilterFromPanel);
  }
  if (filterApplyMobileBtn) {
    filterApplyMobileBtn.addEventListener("click", applyFilterFromPanel);
  }

  if (filterClubJumpToggleBtn) {
    filterClubJumpToggleBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleClubJumpDropdown();
    });
  }

  if (filterClubJumpListEl) {
    filterClubJumpListEl.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var li = t.closest("li.mm-filter-club-jump__option");
      if (!li) return;
      var idx = li.getAttribute("data-sect-index");
      if (idx == null) return;
      closeClubJumpDropdown();
      scrollToFilterClubSection(idx);
    });
  }

  if (filterListRootEl) {
    filterListRootEl.addEventListener("change", onFilterListCheckboxChange);
    filterListRootEl.addEventListener("click", onFilterFavoriteStarClick);
  }

  if (filterOnlyFavoritesCb) {
    filterOnlyFavoritesCb.addEventListener("change", onFilterOnlyFavoritesChange);
  }
  if (filterClearAllBtn) {
    filterClearAllBtn.addEventListener("click", applyFilterClearFromPanel);
  }
  if (filterClearAllBtnMobile) {
    filterClearAllBtnMobile.addEventListener("click", applyFilterClearFromPanel);
  }
  if (filterOnlySelectedCb) {
    filterOnlySelectedCb.addEventListener("change", onFilterOnlySelectedChange);
  }

  if (filterSearchInputEl) {
    filterSearchInputEl.addEventListener("input", function () {
      applyFilterPanelListVisibility();
    });
  }

  /**
   * When URL has events_filter, load every event's starting list so
   * eventParticipantIdMap / aggregate pool are correct on any tab (shared
   * deep links with tab=fights or tab=harmonogram).
   */
  function maybeAggregateForEventsTab() {
    if (!getEventsFilterIdSetFromUrl()) {
      return Promise.resolve();
    }
    return ensureAggregateParticipantMaps()
      .then(function () {
        refreshEventsListVisibility();
      })
      .catch(function () {});
  }

  initCmTabsFromUrl();
  initHomeNav();
  initHelpNav();
  initShareNav();
  updateFilterRootVisibility();
  updateFilterMainButtonLabel();
  syncHeaderEventLine();

  loadEventsIndex().then(function () {
    refreshSlugFromLocation();
    var p = new URLSearchParams(window.location.search);
    var fromUrl = eventSlugFromQuery(p);
    var inList =
      fromUrl &&
      parsedEventsList.some(function (e) {
        return e.slug === fromUrl.slug;
      });

    if (!parsedEventsList.length) {
      if (placeholderEl) placeholderEl.classList.add("is-hidden");
      clearError();
      syncHeaderEventLine();
      refreshEventsListVisibility();
      updatePollingForTab();
      updateFilterMainButtonLabel();
      return;
    }

    if (!fromUrl || !inList) {
      return activateEventSlug(
        cfg.parseEventSlug(parsedEventsList[0].slug),
        getCmTabFromUrl()
      )
        .then(function () {
          return maybeAggregateForEventsTab();
        })
        .catch(function (err) {
          showError(
            "Failed to load event: " +
              (err.message || String(err))
          );
        })
        .then(function () {
          updatePollingForTab();
          updateFilterMainButtonLabel();
        });
    }

    highlightSelectedEventRow(evSlug.slug);
    return ensureEventLoaded(evSlug)
      .then(function () {
        if (placeholderEl) placeholderEl.classList.add("is-hidden");
        clearError();
        syncHeaderEventLine();
        applyCmTabDom(getCmTabFromUrl());
        if (lastFightsData) renderFights(lastFightsData);
        refreshHarmonogram();
        prefetchStartingListEarly();
        updateFilterMainButtonLabel();
        refreshEventsListVisibility();
      })
      .catch(function (err) {
        showError(
          "Failed to load event: " +
            (err.message || String(err))
        );
      })
      .then(function () {
        return maybeAggregateForEventsTab();
      })
      .then(function () {
        updatePollingForTab();
        updateFilterMainButtonLabel();
      });
  });

  window.addEventListener("pagehide", function () {
    stopPoll();
    cmWssClearReconnectTimer();
    cmWssLeaveAllChannels();
    if (cmWss) {
      try {
        cmWss.close();
      } catch (e) {
        /* ignore */
      }
      cmWss = null;
    }
    cmWssInvalidateLiveCacheAndOverlays();
  });
})();
