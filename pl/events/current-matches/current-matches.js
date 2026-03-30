(function () {
  "use strict";

  var cfg = window.MM_CONFIG;
  if (!cfg) {
    console.error("MM_CONFIG missing; load config.js first");
    return;
  }

  var params = new URLSearchParams(window.location.search);

  function eventSlugFromQuery(searchParams) {
    return cfg.parseEventSlug(searchParams.get("slug") || "");
  }

  var evSlug = eventSlugFromQuery(params);
  var eventNumericId = evSlug ? evSlug.numericId : null;

  var contextLabel = document.getElementById("mm-proxy-label");
  if (contextLabel) {
    contextLabel.textContent = evSlug ? evSlug.slug : "—";
  }

  var errEl = document.getElementById("mm-cm-error");
  var contentEl = document.getElementById("mm-cm-content");
  var placeholderEl = document.getElementById("mm-cm-placeholder");
  var toolbarEl = document.getElementById("mm-cm-toolbar");
  var listEl = document.getElementById("mm-fights-list");
  var tabFightsBtn = document.getElementById("mm-cm-tab-fights");
  var tabHarmonogramBtn = document.getElementById("mm-cm-tab-harmonogram");
  var panelFightsEl = document.getElementById("mm-cm-panel-fights");
  var panelHarmonogramEl = document.getElementById("mm-cm-panel-harmonogram");
  var harmonogramRootEl = document.getElementById("mm-cm-harmonogram-root");

  var CM_TAB_FIGHTS = "fights";
  var CM_TAB_HARMONOGRAM = "harmonogram";

  var MM_ROW_FILTER_HIDDEN = "mm-filter-row--filter-hidden";
  var MM_CLUB_FILTER_HIDDEN = "mm-filter-club--filter-hidden";

  var filterRootEl = document.getElementById("mm-cm-filter-root");
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
    var idSet = getFilterIdSetFromUrl();
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
   * @returns {Record<string, true> | null} null = brak filtra (wszystkie walki)
   */
  function getFilterIdSetFromUrl() {
    var raw = new URLSearchParams(window.location.search).get("filter");
    if (raw == null || !String(raw).trim()) return null;
    var parts = String(raw).split(",");
    var map = Object.create(null);
    for (var i = 0; i < parts.length; i++) {
      var id = parts[i].trim();
      if (id) map[id] = true;
    }
    return Object.keys(map).length ? map : null;
  }

  function fightMatchesFilter(row, idSet) {
    if (!idSet) return true;
    var pf = row.publicFight;
    if (!pf) return false;
    var a = pf.firstCompetitor && pf.firstCompetitor.publicId;
    var b = pf.secondCompetitor && pf.secondCompetitor.publicId;
    return Boolean((a && idSet[a]) || (b && idSet[b]));
  }

  function setFilterQueryInUrl(idsUnique) {
    var p = new URLSearchParams(window.location.search);
    if (!idsUnique.length) {
      p.delete("filter");
    } else {
      p.set("filter", idsUnique.join(","));
    }
    var qs = p.toString();
    var path = window.location.pathname || "";
    var hash = window.location.hash || "";
    var next = qs ? path + "?" + qs + hash : path + hash;
    window.history.replaceState(null, "", next);
  }

  function getCmTabFromUrl() {
    var raw = new URLSearchParams(window.location.search).get("tab");
    if (raw && String(raw).toLowerCase() === "harmonogram") {
      return CM_TAB_HARMONOGRAM;
    }
    return CM_TAB_FIGHTS;
  }

  /** Usuwa nieobsługiwane wartości ?tab= z adresu (zostaje tylko harmonogram). */
  function normalizeCmTabParamInUrl() {
    var p = new URLSearchParams(window.location.search);
    var raw = p.get("tab");
    if (!raw) return;
    if (String(raw).toLowerCase() === "harmonogram") return;
    p.delete("tab");
    var qs = p.toString();
    var path = window.location.pathname || "";
    var hash = window.location.hash || "";
    var next = qs ? path + "?" + qs + hash : path + hash;
    window.history.replaceState(null, "", next);
  }

  function setCmTabQueryInUrl(tab) {
    var p = new URLSearchParams(window.location.search);
    if (tab === CM_TAB_HARMONOGRAM) {
      p.set("tab", "harmonogram");
    } else {
      p.delete("tab");
    }
    var qs = p.toString();
    var path = window.location.pathname || "";
    var hash = window.location.hash || "";
    var next = qs ? path + "?" + qs + hash : path + hash;
    window.history.replaceState(null, "", next);
  }

  function applyCmTabDom(tab) {
    var isH = tab === CM_TAB_HARMONOGRAM;
    if (tabFightsBtn) {
      tabFightsBtn.setAttribute("aria-selected", isH ? "false" : "true");
      tabFightsBtn.tabIndex = isH ? -1 : 0;
    }
    if (tabHarmonogramBtn) {
      tabHarmonogramBtn.setAttribute("aria-selected", isH ? "true" : "false");
      tabHarmonogramBtn.tabIndex = isH ? 0 : -1;
    }
    if (panelFightsEl) {
      panelFightsEl.hidden = isH;
    }
    if (panelHarmonogramEl) {
      panelHarmonogramEl.hidden = !isH;
    }
    if (isH) {
      refreshHarmonogram();
    }
  }

  function setCmTab(tab) {
    applyCmTabDom(tab);
    setCmTabQueryInUrl(tab);
  }

  function initCmTabsFromUrl() {
    if (!tabFightsBtn || !tabHarmonogramBtn || !panelFightsEl || !panelHarmonogramEl) {
      return;
    }
    normalizeCmTabParamInUrl();
    applyCmTabDom(getCmTabFromUrl());
    window.addEventListener("popstate", function () {
      applyCmTabDom(getCmTabFromUrl());
      refreshHarmonogram();
      updateFilterMainButtonLabel();
    });
    tabFightsBtn.addEventListener("click", function () {
      setCmTab(CM_TAB_FIGHTS);
    });
    tabHarmonogramBtn.addEventListener("click", function () {
      setCmTab(CM_TAB_HARMONOGRAM);
    });
    var tabsWrap = tabFightsBtn.closest(".mm-cm-tabs");
    if (tabsWrap) {
      tabsWrap.addEventListener("keydown", function (ev) {
        var key = ev.key;
        if (key !== "ArrowLeft" && key !== "ArrowRight") return;
        var cur = getCmTabFromUrl();
        if (key === "ArrowRight" && cur === CM_TAB_FIGHTS) {
          ev.preventDefault();
          setCmTab(CM_TAB_HARMONOGRAM);
          tabHarmonogramBtn.focus();
        } else if (key === "ArrowLeft" && cur === CM_TAB_HARMONOGRAM) {
          ev.preventDefault();
          setCmTab(CM_TAB_FIGHTS);
          tabFightsBtn.focus();
        }
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

  function applyFilterOnlySelectedVisibility() {
    if (!filterListRootEl) return;
    if (!filterOnlySelectedCb || !filterOnlySelectedCb.checked) {
      if (filterOnlyEmptyHintEl) {
        filterOnlyEmptyHintEl.classList.add("is-hidden");
        filterOnlyEmptyHintEl.textContent = "";
      }
      var rowsOff = filterListRootEl.querySelectorAll(".mm-filter-row");
      for (var i = 0; i < rowsOff.length; i++) {
        rowsOff[i].classList.remove(MM_ROW_FILTER_HIDDEN);
      }
      var sectionsOff = filterListRootEl.querySelectorAll(".mm-filter-club");
      for (var so = 0; so < sectionsOff.length; so++) {
        sectionsOff[so].classList.remove(MM_CLUB_FILTER_HIDDEN);
      }
      return;
    }
    var anyChecked = false;
    var rows = filterListRootEl.querySelectorAll(".mm-filter-row");
    for (var j = 0; j < rows.length; j++) {
      var row = rows[j];
      var mcb = row.querySelector(
        'input[type="checkbox"][data-mm-filter-member]'
      );
      var checked = Boolean(mcb && mcb.checked);
      if (checked) anyChecked = true;
      if (checked) {
        row.classList.remove(MM_ROW_FILTER_HIDDEN);
      } else {
        row.classList.add(MM_ROW_FILTER_HIDDEN);
      }
    }
    var sections = filterListRootEl.querySelectorAll(".mm-filter-club");
    for (var k = 0; k < sections.length; k++) {
      var sec = sections[k];
      var childRows = sec.querySelectorAll(".mm-filter-row");
      var vis = false;
      for (var c = 0; c < childRows.length; c++) {
        if (!childRows[c].classList.contains(MM_ROW_FILTER_HIDDEN)) {
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
      if (!anyChecked) {
        filterOnlyEmptyHintEl.textContent = "Brak zaznaczonych zawodników.";
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
    applyFilterOnlySelectedVisibility();
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
      applyFilterOnlySelectedVisibility();
      return;
    }

    if (t.hasAttribute("data-mm-filter-member")) {
      updateClubHeaderCheckboxFromMembers(section);
      applyFilterOnlySelectedVisibility();
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
    applyFilterOnlySelectedVisibility();
  }

  function syncFilterCheckboxesFromUrl() {
    if (!filterListRootEl) return;
    var idSet = getFilterIdSetFromUrl();
    var boxes = filterListRootEl.querySelectorAll(
      'input[type="checkbox"][data-mm-filter-member]'
    );
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      b.checked = Boolean(idSet && idSet[b.value]);
    }
    refreshAllClubHeaderCheckboxes();
    applyFilterOnlySelectedVisibility();
  }

  function countFilterIdsInUrl() {
    var idSet = getFilterIdSetFromUrl();
    if (!idSet) return 0;
    return Object.keys(idSet).length;
  }

  function updateFilterMainButtonLabel() {
    if (!filterMainBtn) return;
    var lab = filterMainBtn.querySelector(".mm-filter-main-btn__label");
    filterMainBtn.setAttribute("aria-expanded", filterPanelOpen ? "true" : "false");
    if (filterPanelOpen) {
      if (lab) lab.textContent = "Hide";
      filterMainBtn.setAttribute(
        "aria-label",
        "Collapse filter panel without applying changes — use Apply Filter to save."
      );
      filterMainBtn.title =
        "Collapse without applying: list and schedule stay as last Apply Filter.";
      return;
    }
    var n = countFilterIdsInUrl();
    if (lab) {
      lab.textContent =
        n > 0 ? "Filtr · " + n : "Filtr · wszyscy";
    }
    filterMainBtn.setAttribute(
      "aria-label",
      n > 0
        ? "Otwórz filtr — aktywnych zawodników w URL: " + n + "."
        : "Otwórz filtr — brak wyboru w URL, pokazywani są wszyscy zawodnicy."
    );
    filterMainBtn.title =
      n > 0
        ? "W filtrze zaznaczono " +
          n +
          " zawodników (zastosowane w URL). Kliknij, by edytować."
        : "Brak filtra w URL — widoczni wszyscy. Kliknij, by wybrać zawodników.";
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
    setFilterQueryInUrl(ids);
    closeFilterPanel();
    if (lastFightsData) {
      renderFights(lastFightsData);
    }
    refreshHarmonogram();
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
    if (startingListEntries) {
      return Promise.resolve(startingListEntries);
    }
    if (startingListLoadPromise) {
      if (filterPanelOpen && filterPanelStatusEl) {
        filterPanelStatusEl.textContent = "Ładowanie list startowych…";
      }
      return startingListLoadPromise;
    }
    if (!evSlug) {
      return Promise.reject(new Error("Brak slug"));
    }
    if (filterPanelOpen && filterPanelStatusEl) {
      filterPanelStatusEl.textContent = "Ładowanie list startowych…";
    }
    startingListLoadPromise = fetchHtml(startingListsPath(evSlug.slug))
      .then(function (html) {
        var entries = parseStartingListHtml(html);
        startingListLoadPromise = null;
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
    if (!filterPanelOpen) {
      openFilterPanel();
      onFilterPanelOpenRequest();
      return;
    }
    closeFilterPanel();
  }

  function prefetchStartingListEarly() {
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

    var idSet = getFilterIdSetFromUrl();
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
    });
  }

  function initWithMats() {
    if (placeholderEl) {
      placeholderEl.classList.add("is-hidden");
    }
    clearError();
    return loadFights().catch(function (err) {
      showError(
        "Nie udało się pobrać walk: " +
          (err.message || String(err))
      );
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

  if (!evSlug || !eventNumericId) {
    if (placeholderEl) {
      placeholderEl.classList.add("is-hidden");
    }
    showError(
      "Brak parametru slug w URL (np. ?slug=628-x-superpuchar-polski-bjj-nogi-gi). Wybierz zawody z listy."
    );
    var p = document.createElement("p");
    p.className = "mm-muted";
    var a = document.createElement("a");
    a.className = "mm-nav-link";
    a.href = cfg.withModeQuery("../");
    a.textContent = "Przejdź do listy zawodów";
    p.appendChild(a);
    if (contentEl) contentEl.appendChild(p);
    initCmTabsFromUrl();
    return;
  }

  if (filterRootEl) {
    filterRootEl.classList.remove("is-hidden");
  }
  updateFilterMainButtonLabel();

  if (filterMainBtn) {
    filterMainBtn.addEventListener("click", onFilterMainButtonClick);
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
      clearAllMemberFilterCheckboxes();
    });
  }
  if (filterOnlySelectedCb) {
    filterOnlySelectedCb.addEventListener("change", function () {
      applyFilterOnlySelectedVisibility();
    });
  }

  prefetchStartingListEarly();
  initCmTabsFromUrl();

  clearError();

  var schedulesPath =
    "/api/events/" + encodeURIComponent(eventNumericId) + "/schedules";

  fetchJson(schedulesPath)
    .then(function (sched) {
      lastSchedulesPayload = sched;
      matNamesById = buildMatMapFromSchedules(sched);
      refreshHarmonogram();
      return initWithMats();
    })
    .catch(function () {
      lastSchedulesPayload = null;
      matNamesById = Object.create(null);
      refreshHarmonogram();
      return initWithMats();
    })
    .then(function () {
      startPolling();
    });

  window.addEventListener("pagehide", stopPoll);
})();
