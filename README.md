# URL Scraper

Fetch any public web page and extract everything that matches a regex pattern (emails, prices, links, whatever you define).

## How it works

- `index.html` is the UI: a URL field, a pattern field, and flags.
- `api/scrape.js` is a Vercel serverless function that fetches the target server-side (so browser CORS never blocks it), applies your regex, and returns up to 1000 matches.
- Safety built in: private and local hosts are refused (SSRF guard), page bodies are capped at 2 MB, matches are capped at 500 chars each, and fetches time out after 20s.

## Status

**Heads-up (2026-10-23):** `url-scraper.vercel.app` currently returns 200 but serves an **unrelated Next.js static export** — not this app. `POST /api/scrape` answers 404, so the live scraper is effectively offline. Fix: unpause the Vercel team and redeploy this repo (or point the domain at the right project). Needs Jay.

The code itself is complete and verified locally (14/14 `node --test`); it goes live again as soon as the right project is deployed.

## Run locally

```bash
npm i -g vercel
vercel dev
# open http://localhost:3000
```

## API

`POST /api/scrape` with JSON body `{ "url": "...", "pattern": "...", "flags": "gi", "maxResults": 200 }` returns `{ "count": n, "matches": [...], "truncated": bool }`.

## Modes

`POST /api/scrape` takes `{ "url", "mode", ... }`:

| mode | extra params | returns |
|---|---|---|
| `matches` | `pattern`, `flags`, `maxResults` | `{ count, matches[], truncated }` |
| `markdown` | — | `{ markdown }` (readability-extracted page as Markdown) |
| `links` | — | `{ count, links: [{href, text}] }` |
| `meta` | — | `{ title, description, headings[], wordCount }` |
| `text` | — | `{ text }` (main content, boilerplate stripped) |

Common options: `respectRobots` (default true — refuses pages disallowed by robots.txt, returns 403 with the reason), `mainContentOnly` (default true — `<article>`/`<main>` preferred, nav/header/footer/aside stripped).

Bulk mode in the UI scrapes a list of URLs with an adjustable concurrency limit (1-10) and a progress bar, then exports everything as JSON.

## Extraction logic

All extraction lives in `api/lib.js` — pure functions, no I/O. Run the unit tests:

```bash
node --test test/lib.test.js
```

Covers: SSRF host blocklist (private IPv4/IPv6, decimal/hex loopback forms), robots.txt parsing (named group beats wildcard, longest-match wins), main-content extraction, Markdown conversion (headings, links, images, lists, blockquotes, tables), link extraction with dedupe, meta extraction, and regex matching with caps.
