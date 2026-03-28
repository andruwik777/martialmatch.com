(function () {
  "use strict";

  var cfg = window.MM_CONFIG;
  if (!cfg) {
    console.error("MM_CONFIG missing; load config.js first");
    return;
  }

  var params = new URLSearchParams(window.location.search);
  var eventId = params.get("event");

  var proxyLabel = document.getElementById("mm-proxy-label");
  if (proxyLabel) {
    proxyLabel.textContent = cfg.mode + " → " + cfg.baseUrl;
  }

  var errEl = document.getElementById("mm-cm-error");
  var contentEl = document.getElementById("mm-cm-content");
  var placeholderEl = document.getElementById("mm-cm-placeholder");
  var toolbarEl = document.getElementById("mm-cm-toolbar");
  var listEl = document.getElementById("mm-fights-list");

  /** matId (string) -> nazwa z /api/events/{id}/schedules — ładowane raz na wizytę strony. */
  var matNamesById = Object.create(null);

  var pollTimerId = null;

  /**
   * fightQueueStatuses[matId]: { fightId, status }
   * Heurystyka UI (brak oficjalnej dokumentacji w API):
   * 1 — aktualna walka na macie, jeszcze nie trwa (np. wezwanie); brązowa belka
   * 2 — walka trwa; zielona belka
   * Inne / brak dopasowania fightId — zaplanowana w kolejce; szara belka
   */
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

  /**
   * API zwraca "YYYY-MM-DD HH:mm:ss" bez strefy — traktujemy jako UTC (zachowanie jak na martialmatch.com).
   * Wyświetlamy w Europe/Warsaw (PL).
   */
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
    var ids = [];
    if (!payload || typeof payload !== "object") return { map: map, ids: ids };
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
    if (!sch || !sch.mats) return { map: map, ids: ids };
    sch.mats.forEach(function (m) {
      var id = m.id;
      ids.push(id);
      map[String(id)] = m.name || "Mata " + id;
    });
    return { map: map, ids: ids };
  }

  function fightsUrl(eventIdStr, matIds) {
    var base = "/api/public/events/" + encodeURIComponent(eventIdStr) + "/fights";
    if (matIds && matIds.length > 0) {
      return base + "?matIds=" + matIds.map(String).join(",");
    }
    return base;
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
    listEl.innerHTML = "";

    var queue = data.fightQueueStatuses || {};
    var rows = (data.result || []).slice();
    rows.sort(function (a, b) {
      return (
        sortKeyStartTime(a.startTime) - sortKeyStartTime(b.startTime)
      );
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
      toolbarEl.textContent =
        "Walki: " +
        rows.length +
        ". Ostatnie odświeżenie: " +
        timeFmt.format(now) +
        " (co " +
        Math.round(cfg.currentMatchesRefreshMs / 1000) +
        " s).";
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
    var matIds = Object.keys(matNamesById).map(function (k) {
      return parseInt(k, 10);
    });
    return fetchJson(fightsUrl(eventId, matIds)).then(function (data) {
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

  if (!eventId || !/^\d+$/.test(eventId)) {
    if (placeholderEl) {
      placeholderEl.classList.add("is-hidden");
    }
    showError(
      "Brak parametru event w URL (np. ?event=628). Wybierz zawody z listy."
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

  clearError();

  var schedulesPath =
    "/api/events/" + encodeURIComponent(eventId) + "/schedules";

  fetchJson(schedulesPath)
    .then(function (sched) {
      var built = buildMatMapFromSchedules(sched);
      matNamesById = built.map;
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
