export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }
  const { url, pattern, flags, maxResults } = req.body || {};
  if (!url || !pattern) {
    return res.status(400).json({ error: "url and pattern are required" });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: "invalid URL" });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).json({ error: "only http/https URLs" });
  }
  // SSRF guard: block private/local hosts
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" || host.endsWith(".local") ||
    host === "127.0.0.1" || host === "0.0.0.0" ||
    host.startsWith("10.") || host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "[::1]"
  ) {
    return res.status(400).json({ error: "private hosts blocked" });
  }
  let regex;
  try {
    const safeFlags = (flags || "g").replace(/[^gimsuy]/g, "").slice(0, 6) || "g";
    regex = new RegExp(pattern, safeFlags.includes("g") ? safeFlags : safeFlags + "g");
  } catch (e) {
    return res.status(400).json({ error: "bad regex: " + e.message });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; URLScraper/1.0)" },
    });
    if (!r.ok) {
      return res.status(502).json({ error: "fetch failed: " + r.status });
    }
    const text = (await r.text()).slice(0, 2_000_000);
    const limit = Math.min(Math.max(parseInt(maxResults) || 100, 1), 1000);
    const matches = [];
    let m;
    while ((m = regex.exec(text)) !== null && matches.length < limit) {
      matches.push(m[0].slice(0, 500));
      if (m[0].length === 0) regex.lastIndex++;
    }
    return res.status(200).json({ count: matches.length, matches, truncated: matches.length >= limit });
  } catch (e) {
    return res.status(502).json({ error: "fetch error: " + (e.name === "AbortError" ? "timeout" : e.message) });
  } finally {
    clearTimeout(timer);
  }
}
