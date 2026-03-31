# MartialMatch viewer

A lightweight web front end for [MartialMatch](https://martialmatch.com) data, focused on **filtering by multiple athletes** and **shareable links**. It is deployed as static files and talks to MartialMatch through a configurable proxy (see `config.js`).

**Live site (GitHub Pages):** [andruwik777.github.io/martialmatch](https://andruwik777.github.io/martialmatch)  
**Source:** [github.com/andruwik777/martialmatch](https://github.com/andruwik777/martialmatch)

## Why this exists

The official MartialMatch site does not let you filter **live fights** and **schedule** by a **set of people at once**. For a **coach at a competition** with a group of kids (or anyone following several athletes), that is awkward: you keep searching manually for who fights when.

This app lets you **pick athletes in a filter** and see only the **fights** and **harmonogram** that matter for **one selected competition** (the active event in the URL via `slug`).

Separately, with **“all competitions”** mode enabled in the UI, you can scan **every competition in the list** and see **which events those athletes are registered for**. That is a **different workflow** from the per-competition filter: the two modes **do not mix** on screen, but they share the same idea—**stay on top of your people**.

Filters are stored in the **URL**, so you can **share a link** with friends or parents and they open the **same filtered view** without redoing the setup.

## Feedback & feature requests

- **Report bugs or request a feature:** [GitHub Issues](https://github.com/andruwik777/martialmatch/issues)

## Disclaimer

Not affiliated with MartialMatch. Behavior depends on MartialMatch’s HTML/API; changes on their side may break scraping or views.
