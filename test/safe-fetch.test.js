import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publicIP, requirePublicUrl, readLimitedText, fetchPublicText,
} from "../api/safe-fetch.js";

const publicDns = async () => [{ address: "8.8.8.8", family: 4 }];
const privateDns = async () => [{ address: "10.4.0.9", family: 4 }];

test("blocks private, reserved and mapped addresses before any network request", async () => {
  for (const ip of [
    "127.0.0.1", "0.0.0.0", "10.8.0.1", "172.17.0.2", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "198.18.0.1", "192.0.2.1",
    "203.0.113.5", "224.0.0.1", "::1", "fe80::1", "fc00::1",
    "::ffff:127.0.0.1", "2001:db8::1",
  ]) assert.equal(publicIP(ip), false, ip);
  assert.equal(publicIP("8.8.8.8"), true);
  assert.equal(publicIP("2606:4700:4700::1111"), true);
  await assert.rejects(requirePublicUrl("http://127.0.0.1/secret"), /private/);
  await assert.rejects(requirePublicUrl("https://user:pass@example.org/", publicDns), /credentials/);
  await assert.rejects(requirePublicUrl("file:///etc/passwd", publicDns), /http/);
});

test("mixed or private DNS answers fail closed", async () => {
  await assert.rejects(
    requirePublicUrl("https://private.example/", privateDns), /private/
  );
  await assert.rejects(
    requirePublicUrl("https://mixed.example/", async () => [
      { address: "8.8.8.8" }, { address: "127.0.0.1" },
    ]), /private/
  );
});

test("an unsafe redirect is blocked BEFORE the second request", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(null, {
      status: 302, headers: { location: "http://127.0.0.1/latest/meta-data" },
    });
  };
  await assert.rejects(
    fetchPublicText("https://example.org/start", { fetchImpl, resolve: publicDns }),
    /private/
  );
  assert.equal(calls, 1);
});

test("a redirect to a private DNS name is blocked before connecting", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(null, {
      status: 302, headers: { location: "https://internal.example/secrets" },
    });
  };
  const resolve = async (hostname) => hostname === "internal.example"
    ? [{ address: "192.168.1.9" }] : publicDns();
  await assert.rejects(
    fetchPublicText("https://example.org/start", { fetchImpl, resolve }),
    /private/
  );
  assert.equal(calls, 1);
});

test("safe relative redirects preserve the final URL", async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push(url);
    assert.equal(options.redirect, "manual");
    if (seen.length === 1) {
      return new Response(null, { status: 302, headers: { location: "/new" } });
    }
    return new Response("hello public web", { status: 200 });
  };
  const out = await fetchPublicText("https://example.org/old", {
    fetchImpl, resolve: publicDns,
  });
  assert.deepEqual(seen, ["https://example.org/old", "https://example.org/new"]);
  assert.equal(out.finalUrl, "https://example.org/new");
  assert.equal(out.text, "hello public web");
});

test("response bodies are bounded before they are held in memory", async () => {
  const text = "x".repeat(50);
  const fetchImpl = async () => new Response(text);
  await assert.rejects(
    fetchPublicText("https://example.org/test", {
      fetchImpl, resolve: publicDns, maxBytes: 20,
    }), /byte limit/
  );
  assert.equal(await readLimitedText(new Response("short"), 20), "short");
});

test("redirect loops stop after bounded hops", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(null, {
      status: 302, headers: { location: "/still-redirecting" },
    });
  };
  await assert.rejects(
    fetchPublicText("https://example.org/", {
      fetchImpl, resolve: publicDns, maxRedirects: 2,
    }), /too many redirects/
  );
  assert.equal(calls, 3);
});
