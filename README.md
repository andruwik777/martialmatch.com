# MartialMatch viewer

## Disclaimer

This project is **not affiliated with** MartialMatch. Functionality depends on MartialMatch’s public HTML and API; changes on their side may break scraping or views.

**Compliance (proxy):** The official **[Regulamin / terms and conditions](https://martialmatch.com/pl/terms-and-conditions)** do not forbid using a **proxy server** to reach the site, and do not spell out a separate **software or API license** that would prohibit a third-party, read-only viewer built on the same public URLs your browser would load. This app is meant as a convenience layer (filtering, shareable links) over that public surface—not to bypass paywalls, authentication, or stated restrictions. *MartialMatch can change their terms at any time; re-read the Regulamin if in doubt. This is the maintainer’s reading, not legal advice.*

---

A lightweight web front end for [MartialMatch](https://martialmatch.com) data, focused on **filtering by multiple athletes** and **shareable links**.

**Live site (Stable):** [andruwik777.github.io/martialmatch.com](https://andruwik777.github.io/martialmatch.com)

**Live site (Early access):** [andruwik777.github.io/dev.martialmatch.com](https://andruwik777.github.io/dev.martialmatch.com)  

## Why this exists

The official MartialMatch site does not provide functionality to filter **live fights** and **schedule** by a **set of people at once**. For a **coach at a competition** with a group of kids (or anyone following several athletes), that is awkward: you keep searching manually for who fights when.

This app lets you **pick athletes in a filter** and see only the **fights** and **harmonogram** that matter for **one selected competition** (the active event in the URL via `slug`).

Separately, with **“all competitions”** mode enabled in the UI, you can scan **every competition in the list** and see **which events those athletes are registered for**. That is a **different workflow** from the per-competition filter: the two modes **do not mix** on screen, but they share the same idea—**stay on top of your people**.

Filters are stored in the **URL**, so you can **share a link** with friends or parents and they open the **same filtered view** without redoing the setup.

## Feedback & feature requests

- **Report bugs or request a feature:** [GitHub Issues](https://github.com/andruwik777/dev.martialmatch.com/issues)

## For developers

Use "mode=test" in query URL parameters to simulate data with active competitions. 

Proxy server is implemented as Cloudflare Workers: **prod** source is `server/prod-martialmatch`, **dev** is `server/dev-martialmatch`, **dev-test** (fixtures) is `server/dev-test-martialmatch`.

**Caching:** The app relies on **server-side** caching (Cloudflare edge / Worker cache for stable HTML and schedule JSON) and **client-side** caching (browser HTTP cache via response headers) so repeat visits do not hammer the original site. Live or frequently changing data (e.g. fights) is not cached the same way.

### Dev vs prod styling (two repos)

After `app.css`, `theme-loader.js` sends a `HEAD` request for **`prod.css`** at the site root (next to `app.css`).

| `prod.css` at root | URL | Extra CSS |
|--------------------|-----|-----------|
| Yes (200) | any | `prod.css` — production look (file can be empty). |
| No | without `mode=test` | `dev.css` |
| No | with `mode=test` | `dev.css` + `dev-test.css` |

**Dev repo:** commit `dev.css`, `dev-test.css`, and `theme-loader.js`; do **not** commit `prod.css`. Use `prod.css.example` as a template.

**Prod repo:** after cloning or merging from dev, add **`prod.css`** (copy from `prod.css.example` or leave empty) and commit it there only.

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

## Challenges & learnings

*This section is a running log of non-obvious issues while building the app; it will keep growing.*

1. **CORS** — Browsers block calling the official site’s HTML/API from a GitHub Pages origin. **Mitigation:** route requests through a **Cloudflare Worker** proxy on a Workers origin, with an explicit `Access-Control-Allow-Origin` for allowed page origins (not `*` when using credentials-sensitive patterns).

2. **Bad CORS advice from ChatGPT ready-to-go solution** — A copy-paste suggestion along the lines of `const allowOrigin = allowedOrigins.includes(origin) ? origin : '*'` is **unsafe**: falling back to `*` (or reflecting arbitrary origins) breaks the point of an allowlist and can create a **cross-origin data leak**. Stick to **either** a matched allowed origin **or** no CORS header / deny.

3. **Two public repos instead of fork** — GitHub does not let you fork your own repo into the same account in the usual way. **Approach:** keep **two** repositories and treat “release” as **merging** early work from dev into prod:
   - **PROD (stable):** [github.com/andruwik777/martialmatch.com](https://github.com/andruwik777/martialmatch.com) → GitHub Pages e.g. `https://andruwik777.github.io/martialmatch/…`
   - **DEV (early access):** [github.com/andruwik777/dev.martialmatch.com](https://github.com/andruwik777/dev.martialmatch.com) → `https://andruwik777.github.io/dev.martialmatch.com/…`

4. **URL shape vs the official site** — Reuse the **same path** as the official site so you only swap the host: conceptually, prefix `https://andruwik777.github.io/` **before** the original host, so the path after it stays `…/pl/events/…`:
   - Original: `https://martialmatch.com/pl/events`
   - Wrapper (if the Pages project name matches): `https://andruwik777.github.io/martialmatch.com/pl/events`  
   In practice, GitHub Pages puts the **repository name** as the first path segment (`…/github.io/<repo>/pl/events/…`), e.g. stable **`martialmatch`** → `https://andruwik777.github.io/martialmatch/pl/events`.

5. **`mode=test` and fixture data** — The **dev** repo includes a **test data** path: the Worker serves **pre-collected** snapshots from the official site, so in that mode the browser **does not** talk to the live official origin for those resources. Enable with the query parameter **`mode=test`**.

6. **Two Cloudflare Workers** — Same split as above:
   - **Dev / test** — small, curated fixture set covering many edge cases (served from repo raw + test worker).
   - **Prod** — thin **proxy** to the **live** official site.

7. **CSS theming** — The dev app UI uses one visual theme; **`mode=test`** uses **another** theme so test mode is visually distinct at a glance.

## Releasing a new version (dev → prod)

**Dev repo:** [github.com/andruwik777/dev.martialmatch.com](https://github.com/andruwik777/dev.martialmatch.com)  
**Prod repo:** [github.com/andruwik777/martialmatch.com](https://github.com/andruwik777/martialmatch.com) — add it as remote **`origin_release`**. Default branch on both workflows below is **`master`**.

### One-time setup (local dev clone)

1. Add the production remote:

   ```bash
   git remote add origin_release https://github.com/andruwik777/martialmatch.com.git
   ```

2. Create a local **`release`** branch (from up-to-date **`master`** if you prefer):

   ```bash
   git checkout master
   git pull origin master
   git checkout -b release
   ```

3. Set upstream for **`release`** to **`origin_release`** (first push):

   ```bash
   git push -u origin_release release
   ```

   Later, when publishing a prepared release commit directly to prod’s **`master`**, you typically use:

   ```bash
   git push origin_release HEAD:master
   ```

**Verify:**

```bash
git remote -v
git branch -vv
```

### Steps to cut a new release

Work in the **dev** repo clone, on branch **`release`** (or create/update it from **`master`**).

1. Switch to the release branch:

   ```bash
   git checkout release
   ```

2. Bring in the latest dev work:

   ```bash
   git merge master -X theirs
   ```

   While **`release`** is checked out, **`theirs`** is **`master`**: if Git reports conflicts, this merge strategy prefers **`master`**’s version of the conflicted hunks (release-only tweaks like **`prod.css`** / **`config.js`** you re-apply in the steps below).

3. Point **`config.js`** at the **prod** Cloudflare Worker URLs (substring replace only — indentation stays the same). Typical mapping for this project:

   ```bash
   sed -i 's|https://dev-martialmatch-v1.andruwik777.workers.dev|https://prod-martialmatch-v1.andruwik777.workers.dev|g' config.js
   sed -i 's|https://dev-test-martialmatch-v1.andruwik777.workers.dev|https://prod-martialmatch-v1.andruwik777.workers.dev|g' config.js
   ```

   Uses **GNU** `sed -i` (Git Bash on Windows, Linux). On **macOS** use `sed -i ''` before the script on each line, e.g. `sed -i '' 's|…|…|g' config.js`.

   Adjust hostnames if your deployed Workers use different names; keep them aligned with **`server/`** and what you actually deployed.

4. Rename the prod theme file so GitHub Pages loads **`prod.css`** (see [Dev vs prod styling](#dev-vs-prod-styling-two-repos)):

   ```bash
   git mv prod.css.example prod.css
   ```

5. Replace **`README.md`** with a **short stub**: the prod repo only needs to publish **`release`** to GitHub Pages — it should not carry a second copy of the full dev README (that drifts and duplicates). Point readers at the dev repo instead:

   ```bash
   printf '%s\n' \
     '# martialmatch.com (release publish)' \
     '' \
     'This repository exists so the **`release`** branch is built as **GitHub Pages** for the stable site.' \
     '' \
     '**Development, documentation, and issues:** [github.com/andruwik777/dev.martialmatch.com](https://github.com/andruwik777/dev.martialmatch.com)' \
     > README.md
   ```

6. Commit with a release message, then create an **annotated or lightweight** tag with the same version (replace `v1.0.0` everywhere below):

   ```bash
   git add config.js prod.css README.md
   git commit -m "Release v1.0.0"
   git tag v1.0.0
   ```

7. Push the **current HEAD** to prod’s **`master`** and push the **tag** (tag name must match step 6):

   ```bash
   git push origin_release HEAD:master
   git push origin_release v1.0.0
   ```

   This updates **[github.com/andruwik777/martialmatch.com](https://github.com/andruwik777/martialmatch.com)** `master` from your local `HEAD` and publishes the tag on **`origin_release`**.

8. Return to daily work:

   ```bash
   git checkout master
   ```

9. **Cloudflare Worker (prod)** — easy to forget: **`git push` does not deploy the proxy.** After the release, copy the repo’s **`server/prod-martialmatch-v1/worker.js`** into the **`prod-martialmatch-v1`** Worker in the Cloudflare dashboard, then click **Deploy** so production matches what you ship in **`server/`**.  
   Direct link (this project’s prod Worker → **Production**): [dash.cloudflare.com → prod-martialmatch-v1](https://dash.cloudflare.com/6b47963c94d644f8d9b7f1cf6f1405bd/workers/services/edit/prod-martialmatch-v1/production).

**Notes**

- **`origin_release`** is used for **every** push to the prod GitHub repo in this workflow; do not mix in `release_origin`.
- If you merge **`release`** back into **`master`** on the **dev** repo, **`prod.css`** can reappear on dev—usually you keep **`prod.css`** only on commits that exist on **`origin_release`**, or you revert **`prod.css`** on **`master`** after the release.
- Update **`REPO_RAW_BASE`** (and similar) in any **test** Worker bundled for prod if fixture raw URLs must point at the **prod** repo or branch.
- Deploying Workers is separate from **`git push`**; align Worker code with what you kept under **`server/`**.
