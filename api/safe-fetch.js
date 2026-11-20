/** Defense-in-depth for public web scraping; no packages required.
 * Revalidates each redirect before issuing the next request, rejects
 * local/reserved DNS addresses, and enforces a real streaming body cap.
 *
 * DNS may rebind between lookup and fetch: production MUST also block
 * internal/private network egress at the hosting-network layer.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { hostBlocked } from "./lib.js";

export function publicIP(address) {
  const raw = String(address || "").replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  const type = net.isIP(raw);
  if (type === 4) {
    const [a, b, c] = raw.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier NAT
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0 ||
        (b === 88 && c === 99))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (type === 6) {
    // Only ordinary global-unicast IPv6; reject IPv4-mapped, local,
    // multicast, 6to4, Teredo and IPv6 documentation networks.
    return /^[23]/.test(raw) && !/^2001:(?::|0:|db8:)/.test(raw) && !raw.startsWith("2002:");
  }
  return false;
}

export async function requirePublicUrl(input, resolve = dns.lookup) {
  let u;
  try { u = new URL(input); }
  catch { throw new Error("invalid URL"); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("only http/https URLs");
  if (!u.hostname || u.username || u.password) throw new Error("URL credentials and empty hosts are disallowed");
  if (hostBlocked(u.hostname)) throw new Error("private hosts blocked");
  const host = u.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (net.isIP(host)) {
    if (!publicIP(host)) throw new Error("private or reserved IP blocked");
    return u;
  }
  let records;
  try { records = await resolve(host, { all: true }); }
  catch { throw new Error("DNS lookup failed"); }
  if (!Array.isArray(records) || records.length === 0 ||
      records.some((x) => !publicIP(x.address))) {
    throw new Error("DNS resolved to a private or reserved IP");
  }
  return u;
}

export async function readLimitedText(response, limit = 2_000_000) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) throw new Error("response exceeds byte limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let count = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > limit) throw new Error("response exceeds byte limit");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
    reader.releaseLock();
  }
}

export async function fetchPublicText(input, {
  fetchImpl = fetch, resolve = dns.lookup, timeout = 20000,
  maxBytes = 2_000_000, maxRedirects = 5, headers = {},
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let current = input;
  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects++) {
      const url = await requirePublicUrl(current, resolve);
      const response = await fetchImpl(url.href, {
        method: "GET", redirect: "manual", signal: controller.signal, headers,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        try { await response.body?.cancel(); } catch { /* no body */ }
        if (!location || redirects === maxRedirects) throw new Error("too many redirects or no Location");
        current = new URL(location, url).href;
        continue;
      }
      return { res: response, text: await readLimitedText(response, maxBytes),
               finalUrl: url.href };
    }
    throw new Error("too many redirects");
  } finally {
    clearTimeout(timer);
  }
}
