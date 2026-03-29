(function () {
  "use strict";

  var cfg = window.MM_CONFIG;
  if (!cfg) {
    console.error("MM_CONFIG missing; load config.js first");
    return;
  }

  var listEl = document.getElementById("mm-events-list");
  var statusEl = document.getElementById("mm-events-status");

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("mm-status--error", !!isError);
  }

  /**
   * @param {Document} doc
   * @returns {{ slug: string, numericId: string, title: string, thumb: string, dateText: string, place: string }[]}
   */
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

      out.push({
        slug: parsed.slug,
        numericId: parsed.numericId,
        title: title,
        thumb: thumb,
        dateText: dateText,
        place: place,
      });
    });

    return out;
  }

  function renderEvents(events) {
    if (!listEl) return;
    listEl.innerHTML = "";

    events.forEach(function (ev) {
      var href = cfg.withModeQuery(
        "current-matches/?slug=" + encodeURIComponent(ev.slug)
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
      titleLink.textContent = ev.title || "Zawody " + ev.numericId;

      var meta = document.createElement("p");
      meta.className = "event-card-meta";
      var metaParts = [];
      if (ev.dateText) metaParts.push(ev.dateText);
      if (ev.place) metaParts.push(ev.place);
      meta.textContent = metaParts.join(" · ");

      var idLine = document.createElement("div");
      idLine.className = "event-card-id";
      idLine.textContent = "ID: " + ev.numericId + " · " + ev.slug;

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
        setStatus("Nadchodzące zawody: " + events.length + ".");
        renderEvents(events);
      })
      .catch(function (err) {
        setStatus("Błąd: " + (err.message || String(err)) + "\nURL: " + url, true);
      });
  }

  document.addEventListener("DOMContentLoaded", load);
})();
