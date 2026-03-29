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

  var filterRootEl = document.getElementById("mm-cm-filter-root");
  var filterMainBtn = document.getElementById("mm-filter-main-btn");
  var filterPanelEl = document.getElementById("mm-filter-panel");
  var filterPanelStatusEl = document.getElementById("mm-filter-panel-status");
  var filterListRootEl = document.getElementById("mm-filter-list-root");
  var filterApplyStickyBtn = document.getElementById("mm-filter-apply-sticky");
  var filterMobileBarEl = document.getElementById("mm-filter-mobile-bar");
  var filterApplyMobileBtn = document.getElementById("mm-filter-apply-mobile");

  var matNamesById = Object.create(null);
  var pollTimerId = null;
  /** @type {object | null} ostatnia poprawna odpowiedź /api/.../fights */
  var lastFightsData = null;

  var filterPanelOpen = false;
  /** @type {Array<{publicId:string,name:string,category:string,clubText:string}>|null} */
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

  function headVariantLabel(v) {
    if (v === "active") return "Walka trwa";
    if (v === "called") return "Na macie";
    return "W kolejce";
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

  var dateFmt = new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  function formatStartLocal(d) {
    if (!d || isNaN(d.getTime())) return "—";
    return dateFmt.format(d) + ", " + timeFmt.format(d);
  }

  function sortKeyStartTime(startTimeStr) {
    var d = parseStartTimeUtc(startTimeStr);
    return d ? d.getTime() : Number.MAX_SAFE_INTEGER;
  }

  function competitorLine(c) {
    if (!c) return "—";
    var name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
    if (!name) return "—";
    var ac = c.academy || "";
    var br = c.branch || "";
    var extra = [ac, br].filter(Boolean).join(" · ");
    return extra ? name + " · " + extra : name;
  }

  function roundLabel(roundName) {
    if (!roundName) return "";
    return String(roundName).replace(/_/g, " ");
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
   * @returns {Array<{publicId:string,name:string,category:string,clubText:string}>}
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
      var col = tr.closest(".column");
      if (col && col.previousElementSibling) {
        var prev = col.previousElementSibling;
        var h4a = prev.querySelector("h4.title.is-4 a");
        if (h4a) {
          category = (h4a.textContent || "").replace(/\s+/g, " ").trim();
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

  function renderFilterListDom(entries) {
    if (!filterListRootEl) return;
    filterListRootEl.innerHTML = "";
    var grouped = groupEntriesByClub(entries);
    for (var c = 0; c < grouped.clubNames.length; c++) {
      var clubName = grouped.clubNames[c];
      var section = document.createElement("section");
      section.className = "mm-filter-club";

      var hn = document.createElement("h3");
      hn.className = "mm-filter-club-name";
      hn.textContent = clubName;
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
        checkWrap.appendChild(cb);

        row.appendChild(textWrap);
        row.appendChild(checkWrap);
        section.appendChild(row);
      }

      filterListRootEl.appendChild(section);
    }
  }

  function syncFilterCheckboxesFromUrl() {
    if (!filterListRootEl) return;
    var idSet = getFilterIdSetFromUrl();
    var boxes = filterListRootEl.querySelectorAll(
      'input[type="checkbox"][data-mm-filter]'
    );
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      b.checked = Boolean(idSet && idSet[b.value]);
    }
  }

  function updateFilterMainButtonLabel() {
    if (!filterMainBtn) return;
    if (filterPanelOpen) {
      filterMainBtn.textContent = "Close";
      return;
    }
    var hasFilter = getFilterIdSetFromUrl() !== null;
    filterMainBtn.textContent = hasFilter ? "Edit filter" : "No filter";
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
    if (filterPanelEl) {
      filterPanelEl.classList.remove("is-hidden");
      filterPanelEl.setAttribute("aria-hidden", "false");
    }
    setFilterMobileBarVisible(true);
    updateFilterMainButtonLabel();
  }

  function closeFilterPanel() {
    filterPanelOpen = false;
    setFilterMobileBarVisible(false);
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
      'input[type="checkbox"][data-mm-filter]:checked'
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
      return startingListLoadPromise;
    }
    if (!evSlug) {
      return Promise.reject(new Error("Brak slug"));
    }
    if (filterPanelStatusEl) {
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
        return entries;
      })
      .catch(function (err) {
        startingListLoadPromise = null;
        startingListEntries = null;
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

  function prefetchStartingListIfFilterInUrl() {
    var raw = new URLSearchParams(window.location.search).get("filter");
    if (!raw || !String(raw).trim()) return;
    ensureStartingListLoaded().catch(function () {
      /* tylko prefetch — błąd pokażemy przy otwarciu panelu */
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

    rows.forEach(function (row) {
      var pf = row.publicFight;
      if (!pf) return;
      var fightId = pf.id;
      var matId = pf.matId;
      var variant = rowHeadVariant(fightId, matId, queue);
      var matName = matNamesById[String(matId)] || "Mata " + matId;

      var article = document.createElement("article");
      article.className = "mm-fight";

      var head = document.createElement("div");
      head.className =
        "mm-fight__head mm-fight__head--" + variant;
      head.textContent = headVariantLabel(variant);

      var body = document.createElement("div");
      body.className = "mm-fight__body";

      var t = parseStartTimeUtc(row.startTime);
      var timeEl = document.createElement("div");
      timeEl.className = "mm-fight__time";
      timeEl.textContent = formatStartLocal(t);

      var matEl = document.createElement("div");
      matEl.className = "mm-fight__mat";
      matEl.textContent = matName;

      var metaEl = document.createElement("div");
      metaEl.className = "mm-fight__category";
      var metaParts = [pf.category || "", roundLabel(pf.roundName)];
      if (pf.fightNumber != null) metaParts.push("#" + pf.fightNumber);
      metaEl.textContent = metaParts.filter(Boolean).join(" · ");

      var c1 = document.createElement("div");
      c1.className = "mm-fight__competitor";
      c1.textContent = competitorLine(pf.firstCompetitor);

      var vs = document.createElement("div");
      vs.className = "mm-fight__vs";
      vs.textContent = "vs";

      var c2 = document.createElement("div");
      c2.className = "mm-fight__competitor";
      c2.textContent = competitorLine(pf.secondCompetitor);

      body.appendChild(timeEl);
      body.appendChild(matEl);
      body.appendChild(metaEl);
      body.appendChild(c1);
      body.appendChild(vs);
      body.appendChild(c2);

      article.appendChild(head);
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

  prefetchStartingListIfFilterInUrl();

  clearError();

  var schedulesPath =
    "/api/events/" + encodeURIComponent(eventNumericId) + "/schedules";

  fetchJson(schedulesPath)
    .then(function (sched) {
      matNamesById = buildMatMapFromSchedules(sched);
      return initWithMats();
    })
    .catch(function () {
      matNamesById = Object.create(null);
      return initWithMats();
    })
    .then(function () {
      startPolling();
    });

  window.addEventListener("pagehide", stopPoll);
})();
