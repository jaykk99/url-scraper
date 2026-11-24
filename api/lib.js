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

/** Keep only valid RegExp flags, g always present, no duplicates. */
export function sanitizeFlags(flags) {
  let safe = "";
  for (const c of String(flags || "g")) {
    if ("gimsuy".includes(c) && !safe.includes(c)) safe += c;
  }
  if (!safe) safe = "g";
  return safe.includes("g") ? safe : safe + "g";
}

/** Common named HTML entities (beyond the handful handled inline below). */
const NAMED_ENTITIES = {
  nbsp: "\u00a0", apos: "'", copy: "\u00a9", reg: "\u00ae", trade: "\u2122",
  hellip: "\u2026", mdash: "\u2014", ndash: "\u2013", lsquo: "\u2018",
  rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d", laquo: "\u00ab",
  raquo: "\u00bb", times: "\u00d7", divide: "\u00f7", plusmn: "\u00b1",
  deg: "\u00b0", frac12: "\u00bd", frac14: "\u00bc", frac34: "\u00be",
  middot: "\u00b7", bull: "\u2022", dagger: "\u2020", Dagger: "\u2021",
  permil: "\u2030", euro: "\u20ac", pound: "\u00a3", yen: "\u00a5",
  cent: "\u00a2", sect: "\u00a7", para: "\u00b6", micro: "\u00b5",
  sup2: "\u00b2", sup3: "\u00b3", acute: "\u00b4", cedil: "\u00b8",
  ordf: "\u00aa", ordm: "\u00ba", iquest: "\u00bf", iexcl: "\u00a1",
  szlig: "\u00df", agrave: "\u00e0", aacute: "\u00e1", acirc: "\u00e2",
  atilde: "\u00e3", auml: "\u00e4", aring: "\u00e5", aelig: "\u00e6",
  ccedil: "\u00e7", egrave: "\u00e8", eacute: "\u00e9", ecirc: "\u00ea",
  euml: "\u00eb", igrave: "\u00ec", iacute: "\u00ed", icirc: "\u00ee",
  iuml: "\u00ef", ntilde: "\u00f1", ograve: "\u00f2", oacute: "\u00f3",
  ocirc: "\u00f4", otilde: "\u00f5", ouml: "\u00f6", oslash: "\u00f8",
  ugrave: "\u00f9", uacute: "\u00fa", ucirc: "\u00fb", uuml: "\u00fc",
  yacute: "\u00fd", yuml: "\u00ff",
};

/** Decode the HTML entities that appear in text content. */
export function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = parseInt(n, 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "\uFFFD";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const cp = parseInt(n, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "\uFFFD";
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m
    );
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
  // The role=main branch back-references its own opening tag, so nested
  // blocks inside the container are kept instead of stopping at the first
  // inner closing tag.
  const mainRe =
    /<(article|main)\b[^>]*>([\s\S]*?)<\/\1\s*>|<(\w+)\b[^>]*\brole=["']?main["']?[^>]*>([\s\S]*?)<\/\3\s*>/i;
  const mainMatch = src.match(mainRe);
  if (mainMatch) {
    const inner = mainMatch[2] || mainMatch[4] || "";
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
  // Tables become real Markdown tables: a separator row after the first
  // row, so renderers treat the pipe lines as a table instead of prose.
  s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi, (_, inner) => {
    const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)]
      .map((m) =>
        [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map((c) =>
          stripTags(c[1]).trim().replace(/\|/g, "\\|")
        )
      )
      .filter((cells) => cells.length > 0);
    if (rows.length === 0) return "";
    const lines = rows.map((cells) => "| " + cells.join(" | ") + " |");
    lines.splice(1, 0, "| " + rows[0].map(() => "---").join(" | ") + " |");
    return "\n\n" + lines.join("\n") + "\n\n";
  });
  s = s.replace(/<\/?(table|thead|tbody|tfoot|tr|td|th)\b[^>]*>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|section|article|header|footer|nav|aside)>/gi, "\n\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim().slice(0, 20000);
}

/** Extract absolute links from HTML: { href, text }. Fragments are stripped,
 * so /page#section resolves to /page instead of being dropped. */
export function extractLinks(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"'\s]+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) !== null) {
    if (m[1].startsWith("#")) continue; // bare fragment: links to this page
    try {
      const u = new URL(m[1], baseUrl);
      u.hash = "";
      const href = u.href;
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
  // Parse meta tags attribute-by-attribute so content= before name= still
  // works; fall back to og:description when no plain description exists.
  let description = "";
  for (const tag of s.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const a of tag[0].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)) {
      attrs[a[1].toLowerCase()] = a[2];
    }
    const name = (attrs.name || attrs.property || "").toLowerCase();
    if ((name === "description" || name === "og:description") && attrs.content) {
      description = decodeEntities(attrs.content).trim().slice(0, 500);
      if (name === "description") break;
    }
  }
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
  let seenRule = false; // a rule line ends the current User-agent group
  const ua = userAgent.toLowerCase();

  const lines = String(body || "")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim());
  for (const line of lines) {
    if (!line) {
      // A blank line ends the current group (per the robots.txt spec).
      currentAgents = [];
      seenRule = false;
      continue;
    }
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      const agent = value.toLowerCase() === "*" ? "*" : value.toLowerCase();
      // Consecutive User-agent lines belong to the same group; a rule
      // line (or blank line) since the last one starts a new group.
      if (seenRule || currentAgents.length === 0) {
        currentAgents = [agent];
        seenRule = false;
      } else {
        currentAgents.push(agent);
      }
    } else if (field === "disallow" || field === "allow") {
      seenRule = true;
      for (const agent of currentAgents) {
        rules.push({ agent, type: field, path: value });
      }
    }
  }
  // Pick the most specific group that matches our UA (or *): longest agent
  // name wins, per the spec; the wildcard is the fallback.
  const groups = new Map();
  for (const r of rules) {
    if (!groups.has(r.agent)) groups.set(r.agent, []);
    groups.get(r.agent).push(r);
  }
  let chosen = groups.get("*") || [];
  let bestLen = -1;
  for (const [agent, group] of groups) {
    if (agent !== "*" && ua.includes(agent) && agent.length > bestLen) {
      chosen = group;
      bestLen = agent.length;
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
  let exhausted = false;
  while (matches.length < limit) {
    m = regex.exec(text);
    if (m === null) {
      exhausted = true;
      break;
    }
    matches.push(m[0].slice(0, 500));
    if (m[0].length === 0) regex.lastIndex++;
  }
  // Truncated only if the cap cut the run short: if the loop ended because
  // the regex ran out of matches, nothing was cut. (A failed exec resets
  // lastIndex to 0, so the probe below only runs when the cap stopped us.)
  let truncated = false;
  if (!exhausted && matches.length >= limit) {
    truncated = regex.exec(text) !== null;
  }
  return { matches, truncated };
}
