# URL Scraper

Fetch any public web page and extract everything that matches a regex pattern (emails, prices, links, whatever you define).

## How it works

- `index.html` is the UI: a URL field, a pattern field, and flags.
- `api/scrape.js` is a Vercel serverless function that fetches the target server-side (so browser CORS never blocks it), applies your regex, and returns up to 1000 matches.
- Safety built in: private and local hosts are refused (SSRF guard), page bodies are capped at 2 MB, matches are capped at 500 chars each, and fetches time out after 20s.

## Status

The deployment is currently **offline: the Vercel team is paused**, so the hosted page cannot reach its API. The code is complete and verified locally; it goes live again as soon as the Vercel project is re-enabled or the repo is deployed to another host that runs Node serverless functions.

## Run locally

```bash
npm i -g vercel
vercel dev
# open http://localhost:3000
```

## API

`POST /api/scrape` with JSON body `{ "url": "...", "pattern": "...", "flags": "gi", "maxResults": 200 }` returns `{ "count": n, "matches": [...], "truncated": bool }`.
