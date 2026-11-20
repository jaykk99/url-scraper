import {
  hostBlocked,
  sanitizeFlags,
  extractMainText,
  htmlToMarkdown,
  extractLinks,
  extractMeta,
  parseRobotsTxt,
  isDisallowed,
  runRegex,
} from "./lib.js";
import { fetchPublicText } from "./safe-fetch.js";

const UA = "Mozilla/5.0 (compatible; URLScraper/1.0)";
const FETCH_TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 2_000_000;

function bad(res, status, error) {
  return res.status(status).json({ error });
}

async function fetchText(url) {
  return fetchPublicText(url, {
    timeout: FETCH_TIMEOUT_MS, maxBytes: MAX_BODY_BYTES,
    headers: { "User-Agent": UA },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return bad(res, 405, "POST only");
  }
  const {
    url,
    pattern,
    flags,
    maxResults,
    mode = "matches",
    respectRobots = true,
    mainContentOnly = true,
  } = req.body || {};

  if (!url) return bad(res, 400, "url is required");
  if (mode === "matches" && !pattern) {
    return bad(res, 400, "pattern is required for mode=matches");
  }
  if (!["matches", "markdown", "links", "meta", "text"].includes(mode)) {
    return bad(res, 400, "mode must be matches, markdown, links, meta or text");
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return bad(res, 400, "invalid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return bad(res, 400, "only http/https URLs");
  }
  if (hostBlocked(parsed.hostname)) {
    return bad(res, 400, "private hosts blocked");
  }

  let regex = null;
  if (mode === "matches") {
    try {
      regex = new RegExp(pattern, sanitizeFlags(flags));
    } catch (e) {
      return bad(res, 400, "bad regex: " + e.message);
    }
  }

  // robots.txt check before fetching the page itself.
  if (respectRobots) {
    try {
      const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
      const { res: rr, text } = await fetchText(robotsUrl);
      if (rr.ok) {
        const rules = parseRobotsTxt(text, "URLScraper");
        const path = parsed.pathname + parsed.search;
        if (isDisallowed(rules, path)) {
          return bad(res, 403, `blocked by robots.txt (Disallow rule for ${path})`);
        }
      }
    } catch {
      // robots.txt unreachable: fail open, the page fetch still has its own guards.
    }
  }

  let fetched;
  try {
    fetched = await fetchText(url);
  } catch (e) {
    return bad(
      res,
      502,
      "fetch error: " + (e.name === "AbortError" ? "timeout" : e.message)
    );
  }
  if (!fetched.res.ok) {
    return bad(res, 502, "fetch failed: " + fetched.res.status);
  }
  const html = fetched.text;
  const base = { url: fetched.finalUrl, fetchedAt: new Date().toISOString() };

  if (mode === "matches") {
    const corpus = mainContentOnly ? extractMainText(html) : html;
    const { matches, truncated } = runRegex(corpus, pattern, flags, maxResults);
    return res.status(200).json({
      ...base,
      mode,
      count: matches.length,
      matches,
      truncated,
    });
  }
  if (mode === "markdown") {
    return res.status(200).json({ ...base, mode, markdown: htmlToMarkdown(html) });
  }
  if (mode === "links") {
    const links = extractLinks(html, fetched.finalUrl);
    return res
      .status(200)
      .json({ ...base, mode, count: links.length, links });
  }
  if (mode === "meta") {
    return res.status(200).json({ ...base, mode, ...extractMeta(html) });
  }
  // mode === "text"
  return res.status(200).json({
    ...base,
    mode,
    text: mainContentOnly ? extractMainText(html) : html.slice(0, 20000),
  });
}
