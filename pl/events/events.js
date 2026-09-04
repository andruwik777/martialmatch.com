(function () {
  "use strict";

  var cfg = window.MM_CONFIG;
  if (!cfg) {
    console.error("MM_CONFIG missing; load config.js first");
    return;
  }

  var listEl = document.getElementById("mm-events-list");
  var statusEl = document.getElementById("mm-events-status");

  /** Class keys from MartialMatch tag.is-event-type (third class). */
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

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("mm-status--error", !!isError);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function flagEmoji(code) {
    if (!code || String(code).length !== 2) return "";
    var c = String(code).toUpperCase();
    var base = 0x1f1e6 - 0x41;
    return String.fromCodePoint(
      base + c.charCodeAt(0),
      base + c.charCodeAt(1)
    );
  }

  /** Month names on martialmatch.com event cards (full genitive + abbreviations). */
  var POLISH_MONTH_TO_INDEX = {
    sty: 0,
    stycznia: 0,
    lut: 1,
    lutego: 1,
    mar: 2,
    marca: 2,
    kwi: 3,
    kwietnia: 3,
    maj: 4,
    maja: 4,
    cze: 5,
    czerwca: 5,
    lip: 6,
    lipca: 6,
    sie: 7,
    sierpnia: 7,
    wrz: 8,
    września: 8,
    wrzesnia: 8,
    paź: 9,
    paz: 9,
    października: 9,
    pazdziernika: 9,
    lis: 10,
    listopada: 10,
    gru: 11,
    grudnia: 11,
  };

  /**
   * @param {string} dateText np. „29 marca 2026” (bez prefiksu „Data zawodów:”)
   * @returns {Date|null} data kalendarzowa lokalnie w południe (DST)
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

  function startOfLocalDay(d) {
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

  function isLocalDateInEventSpan(ref, span) {
    if (!span) return false;
    ref = ref || new Date();
    var r = startOfLocalDay(ref).getTime();
    var a = startOfLocalDay(span.start).getTime();
    var b = startOfLocalDay(span.end).getTime();
    return r >= a && r <= b;
  }

  function registrationFallbackFromEventDates(dateText) {
    var span = parsePolishEventDateSpan(dateText);
    if (!span) return null;
    if (isLocalDateInEventSpan(new Date(), span)) {
      return { kind: "ongoing", text: "Event ongoing" };
    }
    return null;
  }

  function registrationFromListingBadgeText(txt, badgeClass) {
    if (!txt) return null;
    if (/Trwające\s+zawody/i.test(txt)) {
      return { kind: "ongoing", text: txt };
    }
    if (/Rejestracja\s+zako[nń]czona/i.test(txt)) {
      return { kind: "closed", text: txt };
    }
    if (/Start\s+rejestracji/i.test(txt)) {
      return { kind: "start", text: txt };
    }
    if (/Koniec\s+rejestracji/i.test(txt)) {
      return { kind: "end", text: txt };
    }
    if (badgeClass.indexOf("is-warning") !== -1) {
      return { kind: "closed", text: txt };
    }
    if (badgeClass.indexOf("is-info") !== -1) {
      return { kind: "start", text: txt };
    }
    if (badgeClass.indexOf("is-success") !== -1) {
      if (/Trwające/i.test(txt)) return { kind: "ongoing", text: txt };
      return { kind: "end", text: txt };
    }
    return null;
  }

  /**
   * @param {HTMLElement} card
   * @returns {{ kind: string, text: string } | null}
   * kind: ongoing | start | end | closed
   */
  function parseRegistration(card) {
    var badge = card.querySelector(".event-listing-card__registration-badge");
    if (!badge) return null;
    var txt = badge.textContent.replace(/\s+/g, " ").trim();
    if (!txt || txt.length > 200) return null;
    return registrationFromListingBadgeText(txt, badge.className || "");
  }

  function parseEventListingCardDate(card) {
    var cal = card.querySelector(".event-listing-card__detail .fa-calendar-alt");
    var detail = cal && cal.closest(".event-listing-card__detail");
    if (!detail) return "";
    var spans = detail.querySelectorAll("span");
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      if (sp.classList.contains("event-listing-card__detail-icon")) continue;
      var t = sp.textContent.replace(/\s+/g, " ").trim();
      if (t) return t;
    }
    return "";
  }

  function registrationHtml(reg) {
    if (!reg) return "";
    var t = reg.text;
    if (reg.kind === "start") {
      var ms = t.match(/^(Start\s+rejestracji:)\s*(.+)$/i);
      if (ms) {
        return (
          escapeHtml(ms[1]) +
          " <strong>" +
          escapeHtml(ms[2].trim()) +
          "</strong>"
        );
      }
    }
    if (reg.kind === "end") {
      var me = t.match(/^(Koniec\s+rejestracji:)\s*(.+)$/i);
      if (me) {
        return (
          escapeHtml(me[1]) +
          " <strong>" +
          escapeHtml(me[2].trim()) +
          "</strong>"
        );
      }
    }
    return escapeHtml(t);
  }

  /**
   * @param {HTMLElement} row
   * @returns {{ countryCode: string, place: string }}
   */
  function parsePlaceAndFlag(card) {
    var marker = card.querySelector(".event-listing-card__detail .fa-map-marker-alt");
    var locRow = marker && marker.closest(".event-listing-card__detail");
    var countryCode = "";
    var place = "";
    if (!locRow) return { countryCode: countryCode, place: place };

    var flagEl = locRow.querySelector(".flag-icon, .event-listing-card__flag");
    if (flagEl && flagEl.classList) {
      flagEl.classList.forEach(function (c) {
        var m = /^flag-icon-([a-z]{2})$/i.exec(c);
        if (m) countryCode = m[1].toLowerCase();
      });
    }

    var spans = locRow.querySelectorAll("span");
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i];
      if (sp.classList.contains("event-listing-card__detail-icon")) continue;
      if (sp.classList.contains("flag-icon")) continue;
      if (sp.classList.contains("event-listing-card__flag")) continue;
      if (sp.querySelector(".fa-map-marker-alt")) continue;
      if (sp.querySelector(".flag-icon")) continue;
      var t = sp.textContent.replace(/\s+/g, " ").trim();
      if (t && t.length < 120) place = t;
    }
    return { countryCode: countryCode, place: place };
  }

  /**
   * @param {HTMLElement} row
   * @returns {{ key: string, label: string }[]}
   */
  function parseEventTypeTags(card) {
    var out = [];
    card.querySelectorAll(".tag.is-event-type").forEach(function (el) {
      if (el.classList.contains("event-listing-card__types-more")) return;
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

  /**
   * @param {Document} doc
   * @returns {object[]}
   */
  function parseEventsFromDocument(doc) {
    var cards = doc.querySelectorAll("a.event-listing-card[href*='/events/']");
    var out = [];
    var seen = Object.create(null);

    cards.forEach(function (card) {
      var href = card.getAttribute("href") || "";
      var pathMatch = href.match(/\/events\/([^/?#]+)/);
      if (!pathMatch) return;
      var slug = pathMatch[1];
      var parsed = cfg.parseEventSlug(slug);
      if (!parsed) return;
      if (seen[parsed.slug]) return;
      seen[parsed.slug] = true;

      var titleEl = card.querySelector(".event-listing-card__title");
      var title = titleEl
        ? titleEl.textContent.replace(/\s+/g, " ").trim()
        : "";

      var img = card.querySelector("img.event-listing-card__thumbnail");
      var thumb = img ? (img.getAttribute("src") || "").trim() : "";

      var dateText = parseEventListingCardDate(card);
      var pf = parsePlaceAndFlag(card);
      var registration = parseRegistration(card);
      var tags = parseEventTypeTags(card);

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

  var PLACE_PIN_SVG =
    '<svg class="mm-ev-place__pin" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>';

  function renderEvents(events) {
    if (!listEl) return;
    listEl.innerHTML = "";

    events.forEach(function (ev) {
      var href = cfg.withModeQuery(
        "current-matches/?slug=" +
          encodeURIComponent(ev.slug) +
          "&tab=fights"
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
      titleLink.textContent = ev.title || "Event " + ev.numericId;
      body.appendChild(titleLink);

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

      if (ev.registration) {
        var regEl = document.createElement("div");
        regEl.className =
          "mm-ev-reg mm-ev-reg--" + ev.registration.kind;
        regEl.innerHTML = registrationHtml(ev.registration);
        body.appendChild(regEl);
      }

      if (ev.place || ev.countryCode) {
        var placeRow = document.createElement("div");
        placeRow.className = "mm-ev-place";
        placeRow.innerHTML = PLACE_PIN_SVG;
        if (ev.countryCode) {
          var fl = document.createElement("span");
          fl.className = "mm-ev-place__flag";
          fl.textContent = flagEmoji(ev.countryCode);
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
          var mod = KNOWN_EVENT_TYPE_KEYS[t.key]
            ? t.key
            : "default";
          sp.className = "mm-ev-tag mm-ev-tag--" + mod;
          sp.textContent = t.label;
          tagRoot.appendChild(sp);
        });
        body.appendChild(tagRoot);
      }

      article.appendChild(linkInner);
      article.appendChild(body);
      listEl.appendChild(article);
    });
  }

  function load() {
    setStatus("Loading…");
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
            "No events found in HTML (site structure may have changed).",
            true
          );
          return;
        }
        setStatus("Upcoming events: " + events.length + ".");
        renderEvents(events);
      })
      .catch(function (err) {
        setStatus("Error: " + (err.message || String(err)) + "\nURL: " + url, true);
      });
  }

  document.addEventListener("DOMContentLoaded", load);
})();
