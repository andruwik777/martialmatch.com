(function () {
  "use strict";

  var cfg = window.MM_CONFIG;
  if (!cfg) {
    console.error("MM_CONFIG missing; load config.js first");
    return;
  }

  var listEl = document.getElementById("mm-events-list");
  var statusEl = document.getElementById("mm-events-status");
  var proxyLabel = document.getElementById("mm-proxy-label");

  if (proxyLabel) {
    proxyLabel.textContent = cfg.mode + " → " + cfg.baseUrl;
  }

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("mm-status--error", !!isError);
  }

  /** Polish genitive month names as on martialmatch.com (Data zawodów). */
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

  /**
   * @param {string} dateText e.g. "28 marca 2026"
   * @returns {Date|null} local calendar date at noon (avoid DST edge) or null
   */
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

  function isLocalToday(d) {
    var now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }

  /**
   * @param {{ dateText: string }[]} events
   */
  function filterEventsStrictlyToday(events) {
    return events.filter(function (ev) {
      var parsed = parsePolishEventDate(ev.dateText);
      return parsed !== null && isLocalToday(parsed);
    });
  }

  /**
   * @param {Document} doc
   * @returns {{ id: string, title: string, thumb: string, dateText: string, place: string }[]}
   */
  function parseEventsFromDocument(doc) {
    var links = doc.querySelectorAll("a.event-image-link[href*='/events/']");
    var out = [];
    var seen = Object.create(null);

    links.forEach(function (a) {
      var href = a.getAttribute("href") || "";
      var m = href.match(/\/events\/(\d+)-/);
      if (!m) return;
      var id = m[1];
      if (seen[id]) return;
      seen[id] = true;

      var row = a.closest("div.columns.is-centered.is-gapless");
      if (!row) return;

      var titleEl = row.querySelector("a.has-text-white");
      var title = titleEl ? titleEl.textContent.replace(/\s+/g, " ").trim() : "";

      var img = a.querySelector("img.event-thumbnail");
      var thumb = img ? (img.getAttribute("src") || "").trim() : "";

      var dateEl = row.querySelector(".event-date");
      var dateText = dateEl
        ? dateEl.textContent.replace(/\s+/g, " ").replace(/Data zawodów:\s*/i, "").trim()
        : "";

      var place = "";
      var marker = row.querySelector(".fa-map-marker-alt");
      if (marker) {
        var placeRow = marker.closest(".is-size-6");
        if (placeRow) {
          var spans = placeRow.querySelectorAll("span");
          for (var i = spans.length - 1; i >= 0; i--) {
            var t = spans[i].textContent.replace(/\s+/g, " ").trim();
            if (t && t.length < 80 && !/^[A-Z]{2}$/.test(t)) {
              place = t;
              break;
            }
          }
        }
      }

      out.push({ id: id, title: title, thumb: thumb, dateText: dateText, place: place });
    });

    return out;
  }

  function renderEvents(events) {
    if (!listEl) return;
    listEl.innerHTML = "";

    events.forEach(function (ev) {
      var href = cfg.withModeQuery(
        "current-matches/?event=" + encodeURIComponent(ev.id)
      );

      var article = document.createElement("article");
      article.className = "event-card mm-event-row";

      var linkInner = document.createElement("a");
      linkInner.className = "mm-event-row__media";
      linkInner.href = href;
      var img = document.createElement("img");
      img.className = "event-card-thumb";
      img.alt = "";
      img.loading = "lazy";
      img.src = ev.thumb || "";
      img.onerror = function () {
        img.style.visibility = "hidden";
      };
      linkInner.appendChild(img);

      var body = document.createElement("div");
      body.className = "event-card-body";

      var titleLink = document.createElement("a");
      titleLink.className = "event-card-title mm-event-title-link";
      titleLink.href = href;
      titleLink.textContent = ev.title || "Event " + ev.id;

      var meta = document.createElement("p");
      meta.className = "event-card-meta";
      var metaParts = [];
      if (ev.dateText) metaParts.push(ev.dateText);
      if (ev.place) metaParts.push(ev.place);
      meta.textContent = metaParts.join(" · ");

      var idLine = document.createElement("div");
      idLine.className = "event-card-id";
      idLine.textContent = "ID: " + ev.id;

      body.appendChild(titleLink);
      body.appendChild(meta);
      body.appendChild(idLine);

      article.appendChild(linkInner);
      article.appendChild(body);
      listEl.appendChild(article);
    });
  }

  function load() {
    setStatus("Ładowanie…");
    var url = cfg.url("/pl/events");

    fetch(url, { credentials: "omit", headers: { Accept: "text/html" } })
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
          setStatus(
            "Nie znaleziono zawodów w HTML (zmieniła się struktura strony?).",
            true
          );
          return;
        }
        var todayEvents = filterEventsStrictlyToday(events);
        if (todayEvents.length === 0) {
          setStatus(
            "Dziś nie ma zawodów z listy nadchodzących — według dat „Data zawodów” na stronie (jak https://martialmatch.com/pl/events) żadna impreza nie przypada dokładnie na dzisiejszy dzień w strefie czasowej przeglądarki. Zawody na jutro i później są celowo ukryte.",
            false
          );
          return;
        }
        setStatus("Dziś: " + todayEvents.length + " z " + events.length + " z listy.");
        renderEvents(todayEvents);
      })
      .catch(function (err) {
        setStatus("Błąd: " + (err.message || String(err)) + "\nURL: " + url, true);
      });
  }

  document.addEventListener("DOMContentLoaded", load);
})();
