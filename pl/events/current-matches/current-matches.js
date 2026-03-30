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
    var p = new URLSearchParams(window.location.search);
    evSlug = eventSlugFromQuery(p);
    eventNumericId = evSlug ? evSlug.numericId : null;
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
  var panelEventsEl = document.getElementById("mm-cm-panel-events");
  var panelFightsEl = document.getElementById("mm-cm-panel-fights");
  var panelHarmonogramEl = document.getElementById("mm-cm-panel-harmonogram");
  var harmonogramRootEl = document.getElementById("mm-cm-harmonogram-root");

  var CM_TAB_EVENTS = "events";
  var CM_TAB_FIGHTS = "fights";
  var CM_TAB_HARMONOGRAM = "harmonogram";

  var URL_PARAM_EVENTS_FILTER = "events_filter";
  var URL_PARAM_SLUG_FILTER = "slug_filter";

  var eventCache = Object.create(null);
  var parsedEventsList = [];
  /** @type {Record<string, Record<string, true>>} */
  var eventParticipantIdMap = Object.create(null);
  /** @type {Promise<void>|null} */
  var aggregateParticipantMapsPromise = null;

  var MM_ROW_FILTER_HIDDEN = "mm-filter-row--filter-hidden";
  var MM_ROW_SEARCH_HIDDEN = "mm-filter-row--search-hidden";
  var MM_CLUB_FILTER_HIDDEN = "mm-filter-club--filter-hidden";

  var filterRootEl = document.getElementById("mm-cm-filter-root");
  var eventsToolbarEl = document.getElementById("mm-cm-events-toolbar");
  var showAllEventsCb = document.getElementById("mm-show-all-events-cb");
  var changeActiveEventBtn = document.getElementById("mm-change-active-event-btn");
  var filterMainBtnEvents = document.getElementById("mm-filter-main-btn-events");
  var filterMainBtn = document.getElementById("mm-filter-main-btn");
  var filterPanelEl = document.getElementById("mm-filter-panel");
  var filterPanelStatusEl = document.getElementById("mm-filter-panel-status");
  var filterListRootEl = document.getElementById("mm-filter-list-root");
  var filterApplyStickyBtn = document.getElementById("mm-filter-apply-sticky");
  var filterMobileBarEl = document.getElementById("mm-filter-mobile-bar");
  var filterApplyMobileBtn = document.getElementById("mm-filter-apply-mobile");
  var filterClubJumpWrapEl = document.getElementById("mm-filter-club-jump-wrap");
  var filterClubJumpRootEl = document.getElementById("mm-filter-club-jump-root");
  var filterClubJumpToggleBtn = document.getElementById("mm-filter-club-jump-toggle");
  var filterClubJumpListEl = document.getElementById("mm-filter-club-jump-list");
  var filterClearAllBtn = document.getElementById("mm-filter-clear-all-btn");
  var filterOnlySelectedCb = document.getElementById("mm-filter-only-selected-cb");
  var filterOnlyEmptyHintEl = document.getElementById("mm-filter-only-empty-hint");
  var filterSearchInputEl = document.getElementById("mm-filter-search-input");

  var clubJumpOutsideHandler = null;
  var clubJumpEscapeHandler = null;

  var matNamesById = Object.create(null);
  var pollTimerId = null;
  /** @type {object | null} ostatnia poprawna odpowiedź /api/.../fights */
  var lastFightsData = null;
  /** @type {object | null} pełna odpowiedź /api/events/.../schedules */
  var lastSchedulesPayload = null;

  var filterPanelOpen = false;
  /** @type {Array<{publicId:string,name:string,category:string,clubText:string,categoryParameterId:number|null}>|null} */
  var startingListEntries = null;
  var startingListLoadPromise = null;

  var plCollator = new Intl.Collator("pl", { sensitivity: "base" });

  function rowHeadVariant(fightId, matId, queueStatuses) {
    var key = String(matId);
    var q = queueStatuses && queueStatuses[key];
    if (!q || q.fightId !== fightId) return "scheduled";
    if (q.status === 2) return "active";
    if (q.status === 1) return "called";
    return "scheduled";
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

  var timeFmt = new Intl.DateTimeFormat("pl-PL", {
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

  function formatCategoryDisplay(cat) {
    if (!cat) return "";
    return String(cat).replace(/;/g, " ").replace(/\s+/g, " ").trim();
  }

  function roundBadgeList(pf) {
    var rn = (pf.roundName || "").trim();
    var rnl = rn.toLowerCase();
    var list = [];
    if (rnl === "final") list.push({ text: "FINAŁ", variant: "final" });
    else if (rnl === "semi_final") list.push({ text: "SF", variant: "round" });
    else if (rnl === "quarter_final")
      list.push({ text: "1/4", variant: "round" });
    else if (
      rnl === "third_place_playoff" ||
      rnl === "repechage_3rd_place"
    )
      list.push({ text: "o 3 miejsce", variant: "third" });
    else if (rnl === "repechage") list.push({ text: "REP", variant: "round" });
    else if (rn === "1/8" || rnl.indexOf("1/8") === 0)
      list.push({ text: "1/8", variant: "round" });
    else if (rn === "1/4" || rnl.indexOf("1/4") === 0)
      list.push({ text: "1/4", variant: "round" });
    else if (rnl.indexOf("1/2") === 0)
      list.push({ text: "1/2", variant: "round" });
    else if (rn) list.push({ text: rn.replace(/_/g, " "), variant: "neutral" });
    return list;
  }

  var MAT_PIN_SVG =
    '<svg class="mm-fight__mat-pin" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>';

  function competitorDisplayName(c) {
    if (!c) return "—";
    var name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
    return name || "—";
  }

  function competitorClubLine(c) {
    if (!c) return "";
    var ac = c.academy || "";
    var br = c.branch || "";
    return [ac, br].filter(Boolean).join(" · ");
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
    nm.textContent = dn;
    if (/^--/.test(String(dn).trim())) {
      nm.classList.add("mm-muted", "mm-fight__name--placeholder");
    }
    row1.appendChild(nm);
    main.appendChild(row1);

    var club = competitorClubLine(c);
    if (club) {
      var row2 = document.createElement("div");
      row2.className = "mm-fight__club";
      row2.textContent = club;
      main.appendChild(row2);
    }

    wrap.appendChild(cornerEl);
    wrap.appendChild(main);
    return wrap;
  }

  function buildMatDisplayName(matNameRaw, matId) {
    var s = String(matNameRaw || "").trim() || "Mata " + matId;
    s = s.replace(/^mata\s+/i, "mata ");
    if (!/^mata\s/i.test(s)) s = "mata " + s;
    return s.toLowerCase();
  }

  function buildMatMapFromSchedules(payload) {
    var map = Object.create(null);
    if (!payload || typeof payload !== "object") return map;
    var activeId = payload.activeScheduleId;
    var schedules = payload.schedules || [];
    var sch = null;
    for (var i = 0; i < schedules.length; i++) {
      if (schedules[i].id === activeId) {
        sch = schedules[i];
        break;
      }
    }
    if (!sch && schedules.length) sch = schedules[0];
    if (!sch || !sch.mats) return map;
    sch.mats.forEach(function (m) {
      var id = m.id;
      map[String(id)] = m.name || "Mata " + id;
    });
    return map;
  }

  function parseParameterIdFromSchedulesHref(href) {
    if (!href || typeof href !== "string") return null;
    var m = href.match(/[?&]parameterId=(\d+)/);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    return isNaN(n) ? null : n;
  }

  /**
   * @param {object} payload
   * @returns {Record<string, {categoryId:number,categoryName:string,matId:number,matNameRaw:string,start:string,end:string}>}
   */
  function buildCategoryScheduleIndex(payload) {
    var map = Object.create(null);
    if (!payload || typeof payload !== "object") return map;
    var activeId = payload.activeScheduleId;
    var schedules = payload.schedules || [];
    var sch = null;
    for (var i = 0; i < schedules.length; i++) {
      if (schedules[i].id === activeId) {
        sch = schedules[i];
        break;
      }
    }
    if (!sch && schedules.length) sch = schedules[0];
    if (!sch || !sch.mats) return map;
    sch.mats.forEach(function (m) {
      var matId = m.id;
      var matNameRaw = m.name || "Mata " + matId;
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
        };
      });
    });
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
   * @param {{ slot: object, members: Array<{name:string,clubText:string}> }} row
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
      var club = (m.clubText || "").trim();
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
      p.textContent = "Brak danych harmonogramu z API.";
      harmonogramRootEl.appendChild(p);
      return;
    }

    if (!startingListEntries) {
      var p2 = document.createElement("p");
      p2.className = "mm-muted";
      p2.textContent = "Ładowanie list startowej…";
      harmonogramRootEl.appendChild(p2);
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
        ? "Brak wpisów harmonogramu dla wybranych zawodników (wymagany link z parameterId na liście startowej)."
        : "Brak dopasowań: lista startowa bez parameterId lub kategorie poza harmonogramem.";
      harmonogramRootEl.appendChild(empty);
      return;
    }

    var wrap = document.createElement("div");
    wrap.className = "mm-hg-list";
    for (var r = 0; r < rows.length; r++) {
      wrap.appendChild(buildHarmonogramCard(rows[r]));
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

  function isSameLocalCalendarDayEv(d, ref) {
    ref = ref || new Date();
    return (
      d.getFullYear() === ref.getFullYear() &&
      d.getMonth() === ref.getMonth() &&
      d.getDate() === ref.getDate()
    );
  }

  function parseRegistrationEv(row) {
    var pad = row.querySelector(".has-added-padding");
    if (!pad) return null;
    var ed = pad.querySelector(".event-date");
    var regWrap = ed && ed.nextElementSibling;
    if (!regWrap) return null;
    var inner = regWrap.querySelector(
      "span.has-text-success, span.has-text-info, span.has-text-warning"
    );
    if (!inner) return null;
    var txt = inner.textContent.replace(/\s+/g, " ").trim();
    var cls = inner.className || "";
    if (cls.indexOf("has-text-warning") !== -1) {
      return { kind: "closed", text: txt };
    }
    if (cls.indexOf("has-text-info") !== -1) {
      return { kind: "start", text: txt };
    }
    if (cls.indexOf("has-text-success") !== -1) {
      if (/Trwające/i.test(txt)) return { kind: "ongoing", text: txt };
      return { kind: "end", text: txt };
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

      var parsedEventDay = parsePolishEventDate(dateText);
      if (parsedEventDay && isSameLocalCalendarDayEv(parsedEventDay)) {
        registration = { kind: "ongoing", text: "Trwające zawody" };
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

  function getShowAllFromUrl() {
    var v = new URLSearchParams(window.location.search).get("show_all");
    return v !== null && String(v).toLowerCase() === "true";
  }

  function setShowAllInUrl(on) {
    var p = new URLSearchParams(window.location.search);
    if (on) {
      p.set("show_all", "true");
    } else {
      p.delete("show_all");
    }
    replaceLocationQuery(p);
  }

  function refreshEventsListVisibility() {
    if (!eventsListEl) return;
    var articles = eventsListEl.querySelectorAll(".mm-event-row");
    var showAll = getShowAllFromUrl();
    var slugActive = evSlug ? evSlug.slug : "";

    for (var c = 0; c < articles.length; c++) {
      articles[c].classList.remove("mm-event-row--filtered-out");
    }

    if (!showAll && slugActive) {
      for (var f = 0; f < articles.length; f++) {
        articles[f].classList.add("mm-event-row--filtered-out");
      }
      return;
    }

    if (!showAll) {
      return;
    }

    var idSet = getEventsFilterIdSetFromUrl();
    var mapsEmpty = true;
    for (var mp in eventParticipantIdMap) {
      mapsEmpty = false;
      break;
    }
    if (idSet && mapsEmpty) {
      return;
    }
    for (var i = 0; i < articles.length; i++) {
      var art = articles[i];
      var nid = art.getAttribute("data-mm-event-id") || "";
      if (!idSet) continue;
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
        tFill: "Lista startowa: są zawodnicy.",
        tOut: "Lista startowa: brak zawodników (odpowiedź z serwera).",
      },
      {
        lane: c.laneSchedules,
        mod: "schedules",
        tFill: "Harmonogram: w odpowiedzi API są harmonogramy.",
        tOut: "Harmonogram: w odpowiedzi API brak harmonogramów.",
      },
      {
        lane: c.laneFights,
        mod: "fights",
        tFill: "Walki: w odpowiedzi API jest co najmniej jedna walka.",
        tOut: "Walki: w odpowiedzi API brak walk.",
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
      dot.className =
        "mm-event-lane mm-event-lane--" +
        t.mod +
        (t.lane.has ? " mm-event-lane--filled" : " mm-event-lane--outline");
      dot.setAttribute(
        "title",
        t.lane.has ? t.tFill : t.tOut
      );
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
   * @param {object} ev
   * @param {{ interactive?: boolean }} opts
   */
  function buildEventCardNode(ev, opts) {
    opts = opts || {};
    var interactive = !!opts.interactive;
    var root = document.createElement(interactive ? "article" : "div");
    root.className =
      "event-card mm-event-row" +
      (interactive ? "" : " mm-event-row--display-only");
    root.setAttribute("data-mm-event-id", ev.numericId);
    root.setAttribute("data-mm-event-slug", ev.slug);
    if (interactive) {
      root.setAttribute("role", "button");
      root.tabIndex = 0;
      root.setAttribute(
        "aria-label",
        "Wybierz wydarzenie: " + (ev.title || ev.slug)
      );
    }

    var media = document.createElement("div");
    media.className = "mm-event-row__media";
    var img = document.createElement("img");
    img.className = "event-card-thumb";
    img.alt = "";
    img.loading = "lazy";
    img.src = ev.thumb || "";
    img.draggable = false;
    img.onerror = function () {
      img.style.visibility = "hidden";
    };
    media.appendChild(img);

    var body = document.createElement("div");
    body.className = "event-card-body";

    var titleEl = document.createElement("div");
    titleEl.className = "event-card-title";
    titleEl.textContent = ev.title || "Zawody " + ev.numericId;
    body.appendChild(titleEl);

    if (ev.dateText) {
      var dateRow = document.createElement("div");
      dateRow.className = "mm-ev-date";
      var lab = document.createElement("span");
      lab.className = "mm-ev-date__label";
      lab.textContent = "Data zawodów:";
      var val = document.createElement("span");
      val.className = "mm-ev-date__value";
      val.textContent = " " + ev.dateText;
      dateRow.appendChild(lab);
      dateRow.appendChild(val);
      body.appendChild(dateRow);
    }

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
    var title = (c && c.title) || "Zawody " + eventNumericId;
    return {
      slug: evSlug.slug,
      numericId: eventNumericId,
      title: title,
      thumb: "",
      dateText: "",
      place: "",
      countryCode: "",
      registration: null,
      tags: [],
    };
  }

  function loadEventsIndex() {
    setEventsStatus("Ładowanie…");
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
            "Nie znaleziono zawodów w HTML (zmieniła się struktura strony?).",
            true
          );
          parsedEventsList = [];
          return;
        }
        aggregateParticipantMapsPromise = null;
        for (var ek in eventParticipantIdMap) {
          delete eventParticipantIdMap[ek];
        }
        parsedEventsList = events;
        for (var ti = 0; ti < events.length; ti++) {
          var evo = events[ti];
          if (eventCache[evo.numericId]) {
            eventCache[evo.numericId].title = evo.title || "";
          }
        }
        syncHeaderEventLine();
        setEventsStatus("Nadchodzące zawody: " + events.length + ".");
        renderEventsListCm(events);
        refreshEventsListVisibility();
      })
      .catch(function (err) {
        setEventsStatus(
          "Błąd: " + (err.message || String(err)) + "\nURL: " + url,
          true
        );
        parsedEventsList = [];
      });
  }

  function fightsUrl(eventIdStr) {
    return (
      "/api/public/events/" + encodeURIComponent(eventIdStr) + "/fights"
    );
  }

  function startingListsPath(slug) {
    return (
      "/pl/events/" + encodeURIComponent(slug) + "/starting-lists"
    );
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
    var showAll = getShowAllFromUrl();
    var onEvents = tab === CM_TAB_EVENTS;

    if (showAllEventsCb) {
      showAllEventsCb.checked = showAll;
    }

    eventsToolbarEl.classList.toggle("is-hidden", !onEvents);
    filterMainBtn.classList.toggle("is-hidden", onEvents);

    if (changeActiveEventBtn) {
      var showChange = onEvents && !showAll && Boolean(evSlug);
      changeActiveEventBtn.classList.toggle("is-hidden", !showChange);
    }
    if (filterMainBtnEvents) {
      var showFilEv = onEvents && showAll;
      filterMainBtnEvents.classList.toggle("is-hidden", !showFilEv);
    }
  }

  function clearActiveEventSlug() {
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
      placeholderEl.textContent = "Wybierz wydarzenie…";
    }
    clearError();
    notifyUrlChanged();
    highlightSelectedEventRow("");
    refreshEventsListVisibility();
    updateFilterMainButtonLabel();
    stopPoll();
  }

  function syncHeaderEventLine() {
    if (origMmLinkEl && typeof cfg.martialMatchEventUrl === "function") {
      if (evSlug) {
        var mmUrl = cfg.martialMatchEventUrl(evSlug.slug);
        origMmLinkEl.href = mmUrl;
        origMmLinkEl.setAttribute("title", mmUrl);
        origMmLinkEl.classList.remove("is-hidden");
      } else {
        origMmLinkEl.classList.add("is-hidden");
      }
    }
    if (headerPromptEl && headerCardWrapEl && headerCardRootEl) {
      if (!evSlug) {
        headerPromptEl.classList.remove("is-hidden");
        headerCardWrapEl.classList.add("is-hidden");
        headerCardRootEl.innerHTML = "";
      } else {
        headerPromptEl.classList.add("is-hidden");
        headerCardWrapEl.classList.remove("is-hidden");
        headerCardRootEl.innerHTML = "";
        var sum = getEventSummaryForHeader();
        if (sum) {
          headerCardRootEl.appendChild(
            buildEventCardNode(sum, { interactive: false })
          );
        }
      }
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
    startingListEntries = c.startingListEntries || null;
    startingListLoadPromise = null;
  }

  function loadEventBundle(slugObj) {
    var nid = slugObj.numericId;
    var schPath =
      "/api/events/" + encodeURIComponent(nid) + "/schedules";
    return fetchJson(schPath)
      .then(function (sched) {
        return fetchJson(fightsUrl(nid)).then(function (fd) {
          return fetchHtml(startingListsPath(slugObj.slug)).then(function (html) {
            return { sched: sched, fd: fd, html: html };
          });
        });
      })
      .then(function (pack) {
        var mats = buildMatMapFromSchedules(pack.sched);
        var entries = parseStartingListHtml(pack.html);
        var ev = parsedEventsList.filter(function (e) {
          return e.numericId === nid;
        })[0];
        eventCache[nid] = {
          slug: slugObj.slug,
          numericId: nid,
          title: ev ? ev.title || "" : "",
          schedulesPayload: pack.sched,
          fightsData: pack.fd,
          startingListEntries: entries,
          matNamesById: mats,
          loaded: true,
          laneStarting: { has: entries.length > 0 },
          laneSchedules: { has: schedulesPayloadHasData(pack.sched) },
          laneFights: { has: fightsDataHasData(pack.fd) },
        };
        applyCachedEventToView(nid);
        refreshLanesForNumericId(nid);
      });
  }

  function ensureEventLoaded(slugObj) {
    var nid = slugObj.numericId;
    if (eventCache[nid] && eventCache[nid].loaded) {
      applyCachedEventToView(nid);
      return Promise.resolve();
    }
    return loadEventBundle(slugObj);
  }

  function activateEventSlug(slugObj, preferredTab) {
    var tab =
      preferredTab == null ? CM_TAB_EVENTS : preferredTab;
    closeFilterPanel();
    replaceSlugInUrl(slugObj.slug, tab);
    notifyUrlChanged();
    applyCmTabDom(getCmTabFromUrl());
    updateFilterMainButtonLabel();
    refreshEventsListVisibility();
    highlightSelectedEventRow(slugObj.slug);
    if (placeholderEl) {
      placeholderEl.classList.remove("is-hidden");
      placeholderEl.textContent = "Ładowanie…";
    }
    clearError();
    return ensureEventLoaded(slugObj)
      .then(function () {
        syncHeaderEventLine();
        if (placeholderEl) placeholderEl.classList.add("is-hidden");
        clearError();
        if (lastFightsData) renderFights(lastFightsData);
        refreshHarmonogram();
        updatePollingForTab();
        updateFilterMainButtonLabel();
        refreshEventsListVisibility();
      })
      .catch(function (err) {
        showError(
          "Nie udało się wczytać wydarzenia: " +
            (err.message || String(err))
        );
      });
  }

  function ensureAggregateParticipantMaps() {
    if (aggregateParticipantMapsPromise) {
      return aggregateParticipantMapsPromise;
    }
    if (!parsedEventsList.length) {
      return Promise.reject(new Error("Brak listy wydarzeń"));
    }
    var list = parsedEventsList;
    var n = list.length;
    var chain = Promise.resolve();
    for (var idx = 0; idx < n; idx++) {
      (function (ev, i) {
        chain = chain.then(function () {
          if (filterPanelOpen && filterPanelStatusEl) {
            filterPanelStatusEl.textContent =
              "Listy startowe: " + (i + 1) + " / " + n + "…";
          }
          return fetchHtml(startingListsPath(ev.slug))
            .then(function (html) {
              var entries = parseStartingListHtml(html);
              var map = Object.create(null);
              for (var j = 0; j < entries.length; j++) {
                map[entries[j].publicId] = true;
              }
              eventParticipantIdMap[ev.numericId] = map;
              if (!eventCache[ev.numericId]) {
                eventCache[ev.numericId] = {};
              }
              eventCache[ev.numericId].startingListEntries = entries;
              eventCache[ev.numericId].laneStarting = {
                has: entries.length > 0,
              };
              refreshLanesForNumericId(ev.numericId);
            })
            .catch(function () {
              eventParticipantIdMap[ev.numericId] = Object.create(null);
              var ex = eventCache[ev.numericId];
              if (ex && ex.loaded) {
                return;
              }
              if (!eventCache[ev.numericId]) {
                eventCache[ev.numericId] = {};
              }
              eventCache[ev.numericId].startingListEntries = [];
              eventCache[ev.numericId].laneStarting = { has: false };
              refreshLanesForNumericId(ev.numericId);
            });
        });
      })(list[idx], idx);
    }
    aggregateParticipantMapsPromise = chain.then(function () {
      if (filterPanelOpen && filterPanelStatusEl) {
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
      if (!c || !c.startingListEntries) continue;
      var entList = c.startingListEntries;
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
      setCmTab(CM_TAB_FIGHTS);
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
    var c1 = plCollator.compare(ka.first, kb.first);
    if (c1 !== 0) return c1;
    return plCollator.compare(ka.last, kb.last);
  }

  /**
   * @param {string} html
   * @returns {Array<{publicId:string,name:string,category:string,clubText:string,categoryParameterId:number|null}>}
   */
  function parseStartingListHtml(html) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, "text/html");
    var out = [];
    var trs = doc.querySelectorAll("table.table tbody tr");
    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      var nameA = tr.querySelector("a.competitor-name[data-publicid]");
      if (!nameA) continue;
      var publicId = nameA.getAttribute("data-publicid");
      if (!publicId) continue;
      var name = (nameA.textContent || "").replace(/\s+/g, " ").trim();
      var tds = tr.querySelectorAll("td");
      if (tds.length < 3) continue;
      var clubText = (tds[2].textContent || "").replace(/\s+/g, " ").trim();

      var category = "";
      var categoryParameterId = null;
      var col = tr.closest(".column");
      if (col && col.previousElementSibling) {
        var prev = col.previousElementSibling;
        var h4a = prev.querySelector("h4.title.is-4 a");
        if (h4a) {
          category = (h4a.textContent || "").replace(/\s+/g, " ").trim();
          categoryParameterId = parseParameterIdFromSchedulesHref(
            h4a.getAttribute("href") || ""
          );
        } else {
          var h4 = prev.querySelector("h4.title.is-4");
          if (h4) {
            category = (h4.textContent || "").replace(/\s+/g, " ").trim();
          }
        }
      }

      out.push({
        publicId: publicId,
        name: name,
        category: category,
        clubText: clubText || "—",
        categoryParameterId: categoryParameterId,
      });
    }
    return out;
  }

  function groupEntriesByClub(entries) {
    /** @type {Record<string, typeof entries>} */
    var byClub = Object.create(null);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var key = e.clubText || "—";
      if (!byClub[key]) byClub[key] = [];
      byClub[key].push(e);
    }
    var clubNames = Object.keys(byClub);
    clubNames.sort(function (a, b) {
      return plCollator.compare(a, b);
    });
    for (var j = 0; j < clubNames.length; j++) {
      byClub[clubNames[j]].sort(compareEntriesByName);
    }
    return { clubNames: clubNames, byClub: byClub };
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

      var selOk = !onlySel || checked;
      if (selOk) {
        row.classList.remove(MM_ROW_FILTER_HIDDEN);
      } else {
        row.classList.add(MM_ROW_FILTER_HIDDEN);
      }

      if (searchOk && selOk) {
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
        filterOnlyEmptyHintEl.textContent = "Brak zaznaczonych zawodników.";
        filterOnlyEmptyHintEl.classList.remove("is-hidden");
      } else if (query && !anyVisible) {
        filterOnlyEmptyHintEl.textContent =
          "Brak zawodników pasujących do wyszukiwania.";
        filterOnlyEmptyHintEl.classList.remove("is-hidden");
      } else {
        filterOnlyEmptyHintEl.textContent = "";
        filterOnlyEmptyHintEl.classList.add("is-hidden");
      }
    }
  }

  function clearAllMemberFilterCheckboxes() {
    if (!filterListRootEl) return;
    var boxes = filterListRootEl.querySelectorAll(
      'input[type="checkbox"][data-mm-filter-member]'
    );
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].checked = false;
    }
    refreshAllClubHeaderCheckboxes();
    applyFilterPanelListVisibility();
  }

  function onFilterListCheckboxChange(ev) {
    var t = ev.target;
    if (!t || t.type !== "checkbox" || !filterListRootEl) return;
    if (!filterListRootEl.contains(t)) return;
    var section = t.closest(".mm-filter-club");
    if (!section) return;

    if (t.hasAttribute("data-mm-filter-club")) {
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

  function renderFilterListDom(entries) {
    if (!filterListRootEl) return;
    filterListRootEl.innerHTML = "";
    var grouped = groupEntriesByClub(entries);
    for (var c = 0; c < grouped.clubNames.length; c++) {
      var clubName = grouped.clubNames[c];
      var section = document.createElement("section");
      section.className = "mm-filter-club";
      section.id = "mm-filter-club-sect-" + c;

      var hn = document.createElement("h3");
      hn.className = "mm-filter-club-name mm-filter-club-name--with-select";

      var lab = document.createElement("label");
      lab.className = "mm-filter-club-name__label";

      var checkWrap = document.createElement("span");
      checkWrap.className = "mm-filter-club-name__check-wrap";
      var clubCb = document.createElement("input");
      clubCb.type = "checkbox";
      clubCb.setAttribute("data-mm-filter-club", "1");
      clubCb.setAttribute(
        "aria-label",
        "Zaznacz lub usuń zaznaczenie wszystkich z: " + clubName
      );
      clubCb.setAttribute("aria-checked", "false");
      checkWrap.appendChild(clubCb);

      var titleSpan = document.createElement("span");
      titleSpan.className = "mm-filter-club-name__title";
      titleSpan.textContent = clubName;

      lab.appendChild(checkWrap);
      lab.appendChild(titleSpan);
      hn.appendChild(lab);
      section.appendChild(hn);

      var list = grouped.byClub[clubName];
      for (var r = 0; r < list.length; r++) {
        var item = list[r];
        var row = document.createElement("div");
        row.className = "mm-filter-row";
        row.setAttribute(
          "data-mm-filter-search",
          normalizeForFilterSearch(item.name)
        );

        var textWrap = document.createElement("div");
        textWrap.className = "mm-filter-row__text";

        var nameEl = document.createElement("div");
        nameEl.className = "mm-filter-row__name";
        nameEl.textContent = item.name;

        textWrap.appendChild(nameEl);
        if (item.category) {
          var metaEl = document.createElement("div");
          metaEl.className = "mm-filter-row__meta";
          metaEl.textContent = item.category;
          textWrap.appendChild(metaEl);
        }

        var checkWrap = document.createElement("div");
        checkWrap.className = "mm-filter-row__check";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = item.publicId;
        cb.setAttribute("data-mm-filter", "1");
        cb.setAttribute("data-mm-filter-member", "1");
        checkWrap.appendChild(cb);

        row.appendChild(textWrap);
        row.appendChild(checkWrap);
        section.appendChild(row);
      }

      filterListRootEl.appendChild(section);
    }
    rebuildClubJumpDropdown(grouped.clubNames);
    if (filterOnlySelectedCb) {
      filterOnlySelectedCb.checked = false;
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
    var entries =
      c && c.startingListEntries && c.startingListEntries.length
        ? c.startingListEntries
        : null;
    if (
      !entries &&
      startingListEntries &&
      startingListEntries.length &&
      evSlug &&
      String(evSlug.numericId) === String(nid)
    ) {
      entries = startingListEntries;
    }
    if (entries && entries.length) {
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
   * On Wydarzenia tab: all IDs in URL. On Walki/Harmonogram: IDs in URL that
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

  function updateFilterMainButtonLabel() {
    var triggers = [filterMainBtn, filterMainBtnEvents].filter(Boolean);
    if (!triggers.length) return;

    var n = countFilterIdsForMainButton();
    var tab = getCmTabFromUrl();
    var totalUrl =
      tab === CM_TAB_EVENTS
        ? countEventsFilterIdsInUrl()
        : countSlugFilterIdsInUrl();

    for (var ti = 0; ti < triggers.length; ti++) {
      var btn = triggers[ti];
      var lab = btn.querySelector(".mm-filter-main-btn__label");
      btn.setAttribute("aria-expanded", filterPanelOpen ? "true" : "false");
      if (filterPanelOpen) {
        if (lab) lab.textContent = "Hide";
        btn.setAttribute(
          "aria-label",
          "Collapse filter panel without applying changes — use Apply Filter to save."
        );
        btn.title =
          "Collapse without applying: list and schedule stay as last Apply Filter.";
        continue;
      }
      if (lab) {
        if (tab === CM_TAB_EVENTS) {
          lab.textContent =
            totalUrl > 0 ? "Filtr · " + totalUrl : "Filtr · wszyscy";
        } else {
          lab.textContent =
            totalUrl > 0 ? "Filtr · " + n : "Filtr · wszyscy";
        }
      }
      if (tab === CM_TAB_EVENTS) {
        btn.setAttribute(
          "aria-label",
          n > 0
            ? "Otwórz filtr — w URL wybranych zawodników: " + n + "."
            : "Otwórz filtr — brak wyboru w URL, pokazywani są wszyscy zawodnicy."
        );
        btn.title =
          n > 0
            ? "W URL jest " +
              n +
              " zawodników (wszystkie wydarzenia). Kliknij, by edytować."
            : "Brak filtra w URL — widoczni wszyscy. Kliknij, by wybrać zawodników.";
      } else {
        btn.setAttribute(
          "aria-label",
          n > 0
            ? "Otwórz filtr — dla tego wydarzenia aktywnych z URL: " + n + " z " + totalUrl + "."
            : totalUrl > 0
              ? "Otwórz filtr — w URL " +
                totalUrl +
                " zawodników, żaden nie występuje na liście tego wydarzenia."
              : "Otwórz filtr — brak wyboru w URL, pokazywani są wszyscy zawodnicy."
        );
        btn.title =
          n > 0
            ? "Dla tego wydarzenia " +
              n +
              " z " +
              totalUrl +
              " zawodników z URL pasuje do listy startowej. Kliknij, by edytować."
            : totalUrl > 0
              ? "W URL jest " +
                totalUrl +
                " zawodników, ale żaden nie jest na liście tego wydarzenia."
              : "Brak filtra w URL — widoczni wszyscy. Kliknij, by wybrać zawodników.";
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

  function applyFilterFromPanel() {
    var ids = collectCheckedPublicIds();
    if (getCmTabFromUrl() === CM_TAB_EVENTS) {
      setEventsFilterQueryInUrl(ids);
    } else {
      setSlugFilterQueryInUrl(ids);
    }
    closeFilterPanel();
    if (getCmTabFromUrl() === CM_TAB_EVENTS) {
      refreshEventsListVisibility();
    } else {
      if (lastFightsData) {
        renderFights(lastFightsData);
      }
      refreshHarmonogram();
    }
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
      return Promise.reject(new Error("Brak slug"));
    }
    var nid = evSlug.numericId;
    if (
      eventCache[nid] &&
      eventCache[nid].startingListEntries &&
      eventCache[nid].startingListEntries.length
    ) {
      startingListEntries = eventCache[nid].startingListEntries;
      refreshHarmonogram();
      return Promise.resolve(startingListEntries);
    }
    if (startingListEntries && startingListEntries.length) {
      return Promise.resolve(startingListEntries);
    }
    if (startingListLoadPromise) {
      if (filterPanelOpen && filterPanelStatusEl) {
        filterPanelStatusEl.textContent = "Ładowanie list startowych…";
      }
      return startingListLoadPromise;
    }
    if (filterPanelOpen && filterPanelStatusEl) {
      filterPanelStatusEl.textContent = "Ładowanie list startowych…";
    }
    startingListLoadPromise = fetchHtml(startingListsPath(evSlug.slug))
      .then(function (html) {
        var entries = parseStartingListHtml(html);
        startingListLoadPromise = null;
        if (!eventCache[nid]) eventCache[nid] = {};
        eventCache[nid].startingListEntries = entries;
        eventCache[nid].laneStarting = { has: entries.length > 0 };
        refreshLanesForNumericId(nid);
        if (!entries.length) {
          throw new Error("Brak uczestników na liście (nieznany HTML?)");
        }
        startingListEntries = entries;
        refreshHarmonogram();
        return entries;
      })
      .catch(function (err) {
        startingListLoadPromise = null;
        startingListEntries = null;
        refreshHarmonogram();
        throw err;
      });
    return startingListLoadPromise;
  }

  function onFilterPanelOpenRequest() {
    if (getCmTabFromUrl() === CM_TAB_EVENTS) {
      if (!getShowAllFromUrl()) {
        if (filterPanelStatusEl) {
          filterPanelStatusEl.textContent =
            "Włącz „Wszystkie wydarzenia”, aby filtrować listę.";
        }
        if (filterListRootEl) filterListRootEl.innerHTML = "";
        hideClubJumpUI();
        closeFilterPanel();
        return;
      }
      if (filterPanelStatusEl) {
        filterPanelStatusEl.textContent = "Ładowanie wszystkich list…";
      }
      ensureAggregateParticipantMaps()
        .then(function () {
          if (filterPanelStatusEl) filterPanelStatusEl.textContent = "";
          var merged = buildAggregateFilterEntries();
          if (!merged.length) {
            throw new Error("Brak zawodników w listach");
          }
          renderFilterListDom(merged);
          syncFilterCheckboxesFromUrl();
        })
        .catch(function (err) {
          if (filterPanelStatusEl) {
            filterPanelStatusEl.textContent =
              "Nie udało się wczytać list: " +
              (err.message || String(err));
          }
          if (filterListRootEl) filterListRootEl.innerHTML = "";
          hideClubJumpUI();
        });
      return;
    }
    ensureStartingListLoaded()
      .then(function (entries) {
        if (filterPanelStatusEl) filterPanelStatusEl.textContent = "";
        renderFilterListDom(entries);
        syncFilterCheckboxesFromUrl();
      })
      .catch(function (err) {
        if (filterPanelStatusEl) {
          filterPanelStatusEl.textContent =
            "Nie udało się wczytać list: " +
            (err.message || String(err));
        }
        if (filterListRootEl) filterListRootEl.innerHTML = "";
        hideClubJumpUI();
      });
  }

  function onFilterMainButtonClick() {
    if (getCmTabFromUrl() === CM_TAB_EVENTS && !getShowAllFromUrl()) {
      return;
    }
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
    if (pollTimerId !== null) {
      clearInterval(pollTimerId);
      pollTimerId = null;
    }
  }

  function renderFights(data) {
    if (!listEl) return;

    lastFightsData = data;
    listEl.innerHTML = "";

    var idSet = getSlugFilterIdSetFromUrl();
    var queue = data.fightQueueStatuses || {};
    var allRows = (data.result || []).slice();
    allRows.sort(function (a, b) {
      return (
        sortKeyStartTime(a.startTime) - sortKeyStartTime(b.startTime)
      );
    });

    var rows = allRows.filter(function (row) {
      return fightMatchesFilter(row, idSet);
    });

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

      var topbar = document.createElement("div");
      topbar.className =
        "mm-fight__topbar mm-fight__topbar--" + variant;

      var left = document.createElement("div");
      left.className = "mm-fight__topbar-left";

      var num = pf.fightNumber != null ? pf.fightNumber : idx + 1;
      var hash = document.createElement("span");
      hash.className = "mm-fight__fight-num";
      hash.textContent = "#" + num;
      left.appendChild(hash);

      var t = parseStartTimeUtc(row.startTime);
      var timeSpan = document.createElement("span");
      timeSpan.className = "mm-fight__top-time";
      timeSpan.textContent =
        t && !isNaN(t.getTime()) ? timeFmt.format(t) : "—";
      left.appendChild(timeSpan);

      var cat = formatCategoryDisplay(pf.category);
      if (cat) {
        var catEl = document.createElement("span");
        catEl.className = "mm-fight__top-category";
        catEl.textContent = cat;
        left.appendChild(catEl);
      }

      roundBadgeList(pf).forEach(function (b) {
        var badge = document.createElement("span");
        badge.className =
          "mm-fight__rb mm-fight__rb--" + b.variant;
        badge.textContent = b.text;
        left.appendChild(badge);
      });

      var right = document.createElement("div");
      right.className = "mm-fight__topbar-right";
      right.innerHTML = MAT_PIN_SVG;
      var matSpan = document.createElement("span");
      matSpan.className = "mm-fight__mat-label";
      matSpan.textContent = matNameDisplay;
      right.appendChild(matSpan);

      topbar.appendChild(left);
      topbar.appendChild(right);

      var body = document.createElement("div");
      body.className = "mm-fight__body";
      body.appendChild(buildAthleteRow(pf.firstCompetitor, "blue"));
      body.appendChild(buildAthleteRow(pf.secondCompetitor, "red"));

      article.appendChild(topbar);
      article.appendChild(body);
      listEl.appendChild(article);
    });

    if (toolbarEl) {
      toolbarEl.classList.remove("is-hidden");
      var now = new Date();
      var total = allRows.length;
      var shown = rows.length;
      var parts = [];
      if (idSet) {
        parts.push("Walki: " + shown + " z " + total + " (filtr)");
      } else {
        parts.push("Walki: " + shown);
      }
      parts.push(
        "Ostatnie odświeżenie: " +
          timeFmt.format(now) +
          " (co " +
          Math.round(cfg.currentMatchesRefreshMs / 1000) +
          " s)."
      );
      toolbarEl.textContent = parts.join(" ");
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
    return fetchJson(fightsUrl(eventNumericId)).then(function (data) {
      clearError();
      renderFights(data);
      if (eventNumericId && eventCache[eventNumericId]) {
        var c = eventCache[eventNumericId];
        c.fightsData = data;
        if (c.laneFights != null) {
          c.laneFights = { has: fightsDataHasData(data) };
          refreshLanesForNumericId(eventNumericId);
        }
      }
    });
  }

  function startPolling() {
    stopPoll();
    var ms = cfg.currentMatchesRefreshMs || 30000;
    pollTimerId = setInterval(function () {
      loadFights().catch(function () {
        /* zostaw poprzednią listę */
      });
    }, ms);
  }

  if (filterMainBtn) {
    filterMainBtn.addEventListener("click", onFilterMainButtonClick);
  }
  if (filterMainBtnEvents) {
    filterMainBtnEvents.addEventListener("click", onFilterMainButtonClick);
  }
  if (showAllEventsCb) {
    showAllEventsCb.addEventListener("change", function () {
      var on = showAllEventsCb.checked;
      if (!on) {
        closeFilterPanel();
      }
      setShowAllInUrl(on);
      notifyUrlChanged();
      refreshEventsListVisibility();
      updateFilterMainButtonLabel();
    });
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
  }

  if (filterClearAllBtn) {
    filterClearAllBtn.addEventListener("click", function () {
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
        }
        syncFilterCheckboxesFromUrl();
        if (lastFightsData) renderFights(lastFightsData);
        refreshHarmonogram();
        applyFilterPanelListVisibility();
        return;
      }
      clearAllMemberFilterCheckboxes();
    });
  }
  if (filterOnlySelectedCb) {
    filterOnlySelectedCb.addEventListener("change", function () {
      applyFilterPanelListVisibility();
    });
  }

  if (filterSearchInputEl) {
    filterSearchInputEl.addEventListener("input", function () {
      applyFilterPanelListVisibility();
    });
  }

  initCmTabsFromUrl();
  updateFilterRootVisibility();
  updateFilterMainButtonLabel();
  syncHeaderEventLine();

  loadEventsIndex().then(function () {
    refreshSlugFromLocation();
    if (evSlug && eventNumericId) {
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
            "Nie udało się wczytać wydarzenia: " +
              (err.message || String(err))
          );
        });
    } else {
      if (placeholderEl) placeholderEl.classList.add("is-hidden");
      clearError();
      refreshEventsListVisibility();
    }
    updatePollingForTab();
    updateFilterMainButtonLabel();
    if (
      getCmTabFromUrl() === CM_TAB_EVENTS &&
      getShowAllFromUrl() &&
      getEventsFilterIdSetFromUrl()
    ) {
      ensureAggregateParticipantMaps()
        .then(function () {
          refreshEventsListVisibility();
        })
        .catch(function () {});
    }
  });

  window.addEventListener("pagehide", stopPoll);
})();
