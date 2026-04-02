# MartialMatch viewer

A lightweight web front end for [MartialMatch](https://martialmatch.com) data, focused on **filtering by multiple athletes** and **shareable links**.

**Live site (GitHub Pages):** [andruwik777.github.io/dev.martialmatch.com](https://andruwik777.github.io/dev.martialmatch.com)  

## Why this exists

The official MartialMatch site does not let you filter **live fights** and **schedule** by a **set of people at once**. For a **coach at a competition** with a group of kids (or anyone following several athletes), that is awkward: you keep searching manually for who fights when.

This app lets you **pick athletes in a filter** and see only the **fights** and **harmonogram** that matter for **one selected competition** (the active event in the URL via `slug`).

Separately, with **“all competitions”** mode enabled in the UI, you can scan **every competition in the list** and see **which events those athletes are registered for**. That is a **different workflow** from the per-competition filter: the two modes **do not mix** on screen, but they share the same idea—**stay on top of your people**.

Filters are stored in the **URL**, so you can **share a link** with friends or parents and they open the **same filtered view** without redoing the setup.

## Feedback & feature requests

- **Report bugs or request a feature:** [GitHub Issues](https://github.com/andruwik777/dev.martialmatch.com/issues)

## For developers

Use "mode=test" in query URL parameters to simulate data with active competitions. 

Proxy server is implemented as Cloudflare Workers: **prod** source is `server/martialmatch/worker.js`, **test** (fixtures) is `server/test-martialmatch/worker.js`.

### Test worker fixtures

The test Cloudflare Worker serves files from `server/test-martialmatch/data/` via `https://raw.githubusercontent.com/andruwik777/dev.martialmatch.com/master/server/test-martialmatch/data/...` (use `main` instead of `master` in `worker.js` if that is your default branch).

**Regenerate everything** (from the repo root):

```bash
python server/test-martialmatch/build_test_data.py
```

**What the script does**

| Input | Output under `data/` |
|--------|-------------------------|
| `research/html.starting.list` | Per-event `starting-lists.html` (full / first ⅔ / last ⅔ / empty rows) |
| `research/json.harmonogram`, `research/json.przebieg.walk` | `schedules.json` / `fights.json` for the “full data” event and variants |
| Slice of `research/html.pl.events` | `events.html` (list of four test events only) |

**What to edit when things break**

1. **`server/test-martialmatch/build_test_data.py`**
   - `EVENTS_HTML_FIRST_LINE` / `EVENTS_HTML_LAST_LINE` — 1-based line numbers in `research/html.pl.events` for the block that contains exactly the event cards you want in `events.html`. If MartialMatch changes the HTML, re-open that file in an editor, find the first `<div class="columns is-centered is-gapless">` of your first card and the closing `</div>` after the last card, note line numbers, and update both constants.
   - `SLUGS` — folder names under `data/` and the slugs must stay in sync with **`server/test-martialmatch/worker.js`** (`NUMERIC_TO_SLUG` and `ALLOWED_SLUGS`).
   - Source paths at the top (`SRC`, `EVENTS_SRC`, `SCHED_SRC`, `FIGHTS_SRC`) if you snapshot new research files.

2. **`server/test-martialmatch/worker.js`**
   - `REPO_RAW_BASE` — must match this repo on GitHub (`andruwik777/dev.martialmatch.com`) and default branch.
   - `NUMERIC_TO_SLUG` — must list every numeric event id the app can request in test mode and match the folders under `data/`.

3. **`server/martialmatch/worker.js`** (prod proxy) — deploy to your prod Worker; update `allowedOrigins` if the app is served from a custom domain.

After changing fixtures, run the script, commit `data/`, push, then the test Worker can fetch the new raw URLs.

## Disclaimer

Not affiliated with MartialMatch. Behavior depends on MartialMatch’s HTML/API; changes on their side may break scraping or views.
