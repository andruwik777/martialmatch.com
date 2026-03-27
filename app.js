(function () {
  "use strict";

  /** Przykładowe wpisy (jak na /pl/events) — później zastąp parsowaniem HTML / API. */
  var SAMPLE_EVENTS = [
    {
      id: 628,
      title: "X SuperPuchar Polski BJJ NoGi &Gi",
      date: "28 marca 2026",
      place: "Siewierz",
      thumb: "https://static.martialmatch.com/images/p/thumb_628.jpg?v=1759955101",
    },
    {
      id: 707,
      title: "Puchar Polski Południowej ADCC",
      date: "28 marca 2026",
      place: "Wieliczka",
      thumb: "https://static.martialmatch.com/images/p/thumb_707.jpeg?v=1768155980",
    },
    {
      id: 723,
      title: "Grand Prix Polski Combat Ju Jutsu",
      date: "28 marca 2026",
      place: "—",
      thumb: "https://static.martialmatch.com/images/p/thumb_723.jpg?v=1767877797",
    },
  ];

  /** Cloudflare Worker (CORS) → martialmatch.com */
  var API_BASE = "https://martialmatch.andruwik777.workers.dev";
  var API_TEMPLATE = API_BASE + "/api/events/{id}/results/public";

  function apiUrl(eventId) {
    return API_TEMPLATE.replace("{id}", String(eventId));
  }

  function renderEvents(container) {
    SAMPLE_EVENTS.forEach(function (ev) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "event-card";
      btn.setAttribute("data-event-id", String(ev.id));

      var img = document.createElement("img");
      img.className = "event-card-thumb";
      img.src = ev.thumb;
      img.alt = "";
      img.loading = "lazy";
      img.onerror = function () {
        img.style.visibility = "hidden";
      };

      var body = document.createElement("div");
      body.className = "event-card-body";

      var h = document.createElement("h3");
      h.className = "event-card-title";
      h.textContent = ev.title;

      var p = document.createElement("p");
      p.className = "event-card-meta";
      p.textContent = ev.date + " · " + ev.place;

      var idLine = document.createElement("div");
      idLine.className = "event-card-id";
      idLine.textContent = "ID: " + ev.id + " → " + apiUrl(ev.id);

      body.appendChild(h);
      body.appendChild(p);
      body.appendChild(idLine);

      btn.appendChild(img);
      btn.appendChild(body);

      btn.addEventListener("click", function () {
        fetchPublicResults(ev.id);
      });

      container.appendChild(btn);
    });
  }

  function setResult(text, isError) {
    var el = document.getElementById("result");
    el.textContent = text;
    el.classList.toggle("is-error", !!isError);
  }

  function fetchPublicResults(eventId) {
    var url = apiUrl(eventId);
    setResult("Ładowanie…\n" + url, false);

    fetch(url, {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" },
    })
      .then(function (res) {
        var lines = [
          "URL: " + url,
          "HTTP: " + res.status + " " + res.statusText,
          "ok: " + res.ok,
        ];
        var corsHeader =
          res.headers.get("access-control-allow-origin") ||
          res.headers.get("Access-Control-Allow-Origin");
        lines.push(
          "Access-Control-Allow-Origin (jeśli widoczny w JS): " +
            (corsHeader !== null ? corsHeader : "(brak)")
        );

        return res.text().then(function (raw) {
          lines.push("", "--- body ---", raw);
          try {
            var parsed = JSON.parse(raw);
            lines.push("", "--- JSON ---", JSON.stringify(parsed, null, 2));
          } catch (e) {
            lines.push("", "(parse JSON: " + e.message + ")");
          }
          setResult(lines.join("\n"), !res.ok);
        });
      })
      .catch(function (err) {
        setResult(
          [
            "Błąd sieci / CORS:",
            String(err && err.message ? err.message : err),
            "",
            "Użyj serwera HTTP (nie file://), np. npx serve . w folderze projektu.",
            "",
            "URL: " + url,
          ].join("\n"),
          true
        );
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var container = document.getElementById("events");
    if (container) {
      renderEvents(container);
    }
  });
})();
