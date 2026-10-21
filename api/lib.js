/**
 * api/lib.js — pure extraction helpers for the URL scraper.
 * No I/O, no network: everything here is unit-testable with node:test.
 */

/** SSRF guard: hostnames we refuse to fetch. */
export function hostBlocked(host) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  return (
    h === "localhost" ||
    h.endsWith(".local") ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "[::1]" ||
    h === "::1" ||
    h.startsWith("10.") ||
    h.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.startsWith("169.254.") ||
    h === "2130706433" || // 127.0.0.1 as decimal
    h === "0x7f000001" // 127.0.0.1 as hex
  );
}

/** Keep only valid RegExp flags, g always present. */
export function sanitizeFlags(flags) {
  const safe = String(flags || "g").replace(/[^gimsuy]/g, "").slice(0, 6) || "g";
  return safe.includes("g") ? safe : safe + "g";
}

/** Decode the handful of HTML entities that appear in text content. */
export function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/** Strip tags but keep word boundaries so text does not run together. */
function stripTags(html) {
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

/**
 * Readability-style main-content extraction.
 * Prefers <article>, <main>, or [role=main]; otherwise drops boilerplate
 * (nav, header, footer, aside, scripts, styles) and returns the text of the
 * longest remaining block-level chunk.
 */
export function extractMainText(html) {
  const src = String(html || "");

  // 1. Prefer semantic main-content containers.
  const mainRe =
    /<(article|main)\b[^>]*>([\s\S]*?)<\/\1\s*>|<\w+\b[^>]*\brole=["']?main["']?[^>]*>([\s\S]*?)<\/\w+\s*>/i;
  const mainMatch = src.match(mainRe);
  if (mainMatch) {
    const inner = mainMatch[2] || mainMatch[3] || "";
    const text = stripTags(inner.replace(/<(script|style|nav|aside|footer|header)[\s\S]*?<\/\1\s*>/gi, ""));
    if (text.length >= 40) return text;
  }

  // 2. Remove boilerplate, then pick the longest text block.
  let body = src.replace(/<(script|style|noscript)[\s\S]*?<\/\1\s*>/gi, " ");
  body = body.replace(/<(nav|header|footer|aside|form|iframe)[\s\S]*?<\/\1\s*>/gi, " ");
  const blocks = body
    .split(/<\/(div|section|article|p|li|td|blockquote)>/i)
    .map((b) => stripTags(b))
    .filter((b) => b.length >= 40);
  if (blocks.length === 0) return stripTags(body).slice(0, 20000);
  blocks.sort((a, b) => b.length - a.length);
  // Return the biggest block plus any other big block (>=40% of the biggest)
  const biggest = blocks[0].length;
  return blocks
    .filter((b) => b.length >= biggest * 0.4)
    .slice(0, 5)
    .join("\n\n")
    .slice(0, 20000);
}

/**
 * Convert HTML to Markdown. Handles headings, paragraphs, links, images,
 * bold/italic, lists, blockquotes and code. Table support is intentionally
 * simple: rows become pipe lines.
 */
export function htmlToMarkdown(html) {
  let s = String(html || "");
  s = s.replace(/<(script|style|noscript)[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");

  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_, lvl, inner) => {
    return "\n\n" + "#".repeat(parseInt(lvl, 10)) + " " + stripTags(inner).trim() + "\n\n";
  });
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_, href, inner) => {
    const text = stripTags(inner).trim();
    return text && text !== href ? `[${text}](${href})` : href;
  });
  s = s.replace(/<img\b[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, "![ $2 ]($1)");
  s = s.replace(/<img\b[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, "![]($1)");
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, "**$2**");
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, "_$2_");
  s = s.replace(/<(code|pre)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, "`$2`");
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote\s*>/gi, (_, inner) =>
    stripTags(inner)
      .split("\n")
      .map((l) => "> " + l)
      .join("\n")
  );
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, "- $1\n");
  s = s.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, "\n$2\n");
  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi, (_, inner) => {
    const cells = [...inner.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map((m) =>
      stripTags(m[1]).trim().replace(/\|/g, "\\|")
    );
    return cells.length ? "\n| " + cells.join(" | ") + " |" : "";
  });
  s = s.replace(/<\/?(table|thead|tbody|tfoot)\b[^>]*>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|section|article|header|footer|nav|aside)>/gi, "\n\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim().slice(0, 20000);
}

/** Extract absolute links from HTML: { href, text }. */
export function extractLinks(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"'#\s]+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) !== null) {
    try {
      const href = new URL(m[1], baseUrl).href;
      if (!/^https?:/.test(href) || seen.has(href)) continue;
      seen.add(href);
      out.push({ href, text: stripTags(m[2]).trim().slice(0, 200) });
      if (out.length >= 1000) break;
    } catch {
      /* skip unresolvable hrefs */
    }
  }
  return out;
}

/** Extract title, meta description, headings and word count. */
export function extractMeta(html) {
  const s = String(html || "");
  const pick = (re) => {
    const m = s.match(re);
    return m ? decodeEntities(m[1]).trim().slice(0, 500) : "";
  };
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title\s*>/i);
  const description = pick(
    /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i
  );
  const headings = [];
  const hre = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
  let m;
  while ((m = hre.exec(s)) !== null && headings.length < 100) {
    headings.push({ level: parseInt(m[1], 10), text: stripTags(m[2]).trim().slice(0, 200) });
  }
  const wordCount = (stripTags(s).match(/\S+/g) || []).length;
  return { title, description, headings, wordCount };
}

/**
 * Parse a robots.txt body into [{ path, allow }] rules for a user-agent group.
 * Returns the rules of the most specific matching group (* if none other match).
 */
export function parseRobotsTxt(body, userAgent = "*") {
  const rules = [];
  let currentAgents = [];
  let best = null; // { specificity, rules }
  const ua = userAgent.toLowerCase();

  const lines = String(body || "")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim());
  for (const line of lines) {
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      currentAgents = value.toLowerCase() === "*" ? ["*"] : [value.toLowerCase()];
    } else if (field === "disallow" || field === "allow") {
      for (const agent of currentAgents) {
        rules.push({ agent, type: field, path: value });
      }
    }
  }
  // Pick the most specific group that matches our UA (or *).
  const groups = new Map();
  for (const r of rules) {
    if (!groups.has(r.agent)) groups.set(r.agent, []);
    groups.get(r.agent).push(r);
  }
  let chosen = groups.get("*") || [];
  for (const [agent, group] of groups) {
    if (agent !== "*" && ua.includes(agent)) {
      chosen = group; // a named group beats the wildcard
      break;
    }
  }
  return chosen.map((r) => ({ type: r.type, path: r.path }));
}

/** True if the path is disallowed by the parsed robots rules. Longest match wins. */
export function isDisallowed(rules, path) {
  let decision = false;
  let longest = -1;
  for (const r of rules) {
    if (!r.path) {
      // "Disallow:" (empty) means allow everything.
      if (r.type === "disallow" && longest < 0) {
        decision = false;
        longest = 0;
      }
      continue;
    }
    if (path.startsWith(r.path) && r.path.length > longest) {
      longest = r.path.length;
      decision = r.type === "disallow";
    }
  }
  return decision;
}

/** Run a regex over text, returning capped matches. */
export function runRegex(text, pattern, flags, maxResults) {
  const regex = new RegExp(pattern, sanitizeFlags(flags));
  const limit = Math.min(Math.max(parseInt(maxResults, 10) || 100, 1), 1000);
  const matches = [];
  let m;
  while ((m = regex.exec(text)) !== null && matches.length < limit) {
    matches.push(m[0].slice(0, 500));
    if (m[0].length === 0) regex.lastIndex++;
  }
  return { matches, truncated: matches.length >= limit };
}
