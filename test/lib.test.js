import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hostBlocked,
  sanitizeFlags,
  decodeEntities,
  extractMainText,
  htmlToMarkdown,
  extractLinks,
  extractMeta,
  parseRobotsTxt,
  isDisallowed,
  runRegex,
} from "../api/lib.js";

test("hostBlocked refuses private and local hosts", () => {
  for (const h of [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "10.0.0.5",
    "192.168.1.1",
    "172.16.4.9",
    "172.31.255.1",
    "169.254.169.254",
    "example.local",
    "[::1]",
    "2130706433",
    "0x7f000001",
    "",
  ]) {
    assert.ok(hostBlocked(h), `expected blocked: ${h}`);
  }
});

test("hostBlocked allows public hosts", () => {
  for (const h of ["example.com", "8.8.8.8", "172.15.0.1", "172.32.0.1", "en.wikipedia.org"]) {
    assert.ok(!hostBlocked(h), `expected allowed: ${h}`);
  }
});

test("sanitizeFlags keeps valid flags and always includes g", () => {
  assert.equal(sanitizeFlags("gi"), "gi");
  assert.equal(sanitizeFlags("i"), "ig");
  assert.equal(sanitizeFlags("gi!@#"), "gi");
  assert.equal(sanitizeFlags(""), "g");
  assert.equal(sanitizeFlags(null), "g");
});

test("decodeEntities handles common entities and numeric refs", () => {
  assert.equal(decodeEntities("a &amp; b &lt;c&gt;"), "a & b <c>");
  assert.equal(decodeEntities("it&#39;s &#x41;"), "it's A");
});

test("extractMainText prefers <article> over boilerplate", () => {
  const html = `
    <html><body>
    <nav><a href="/x">Nav link one</a><a href="/y">Nav link two</a></nav>
    <article><h1>The Real Story</h1><p>${"Body sentence here. ".repeat(20)}</p></article>
    <footer>Copyright 2026 footer words here</footer>
    </body></html>`;
  const text = extractMainText(html);
  assert.ok(text.includes("The Real Story"), "should include article content");
  assert.ok(!text.includes("Nav link"), "should exclude nav");
  assert.ok(!text.includes("Copyright"), "should exclude footer");
});

test("extractMainText strips scripts and styles", () => {
  const html = `<html><body><script>var x = 1;</script><style>.a{color:red}</style>
    <div><p>${"Real paragraph content words. ".repeat(15)}</p></div></body></html>`;
  const text = extractMainText(html);
  assert.ok(!text.includes("var x"), "script content removed");
  assert.ok(!text.includes("color:red"), "style content removed");
  assert.ok(text.includes("Real paragraph"), "body text kept");
});

test("htmlToMarkdown converts headings, links, lists and bold", () => {
  const html = `
    <h1>Title Here</h1>
    <p>Some <strong>bold</strong> and <em>italic</em> text with a
    <a href="https://example.com/page">link</a>.</p>
    <ul><li>First item</li><li>Second item</li></ul>`;
  const md = htmlToMarkdown(html);
  assert.ok(md.includes("# Title Here"), "heading converted");
  assert.ok(md.includes("**bold**"), "bold converted");
  assert.ok(md.includes("_italic_"), "italic converted");
  assert.ok(md.includes("[link](https://example.com/page)"), "link converted");
  assert.ok(md.includes("- First item"), "list converted");
  assert.ok(!/<[^>]+>/.test(md), "no tags remain");
});

test("htmlToMarkdown converts tables to pipe rows", () => {
  const html = `<table><tr><th>Name</th><th>Price</th></tr>
    <tr><td>Widget</td><td>$5.00</td></tr></table>`;
  const md = htmlToMarkdown(html);
  assert.ok(md.includes("| Name | Price |"), "header row");
  assert.ok(md.includes("| Widget | $5.00 |"), "data row");
});

test("extractLinks resolves relative URLs and dedupes", () => {
  const html = `<a href="/about">About</a><a href="/about">About again</a>
    <a href="https://other.com/x">Ext</a><a href="mailto:a@b.com">Mail</a>
    <a href="#frag">Frag</a>`;
  const links = extractLinks(html, "https://example.com/page");
  const hrefs = links.map((l) => l.href);
  assert.ok(hrefs.includes("https://example.com/about"), "relative resolved");
  assert.equal(hrefs.filter((h) => h === "https://example.com/about").length, 1, "deduped");
  assert.ok(hrefs.includes("https://other.com/x"), "absolute kept");
  assert.ok(!hrefs.some((h) => h.startsWith("mailto:")), "mailto skipped");
});

test("extractMeta pulls title, description, headings and word count", () => {
  const html = `<html><head><title>My Page</title>
    <meta name="description" content="A test page."></head>
    <body><h1>Hi</h1><h2>Sub</h2><p>one two three four five</p></body></html>`;
  const meta = extractMeta(html);
  assert.equal(meta.title, "My Page");
  assert.equal(meta.description, "A test page.");
  assert.deepEqual(
    meta.headings.map((h) => h.text),
    ["Hi", "Sub"]
  );
  assert.ok(meta.wordCount >= 7, "word count counted");
});

test("parseRobotsTxt + isDisallowed honour Disallow rules", () => {
  const body = `
    User-agent: *
    Disallow: /admin/
    Disallow: /private
    Allow: /private/public/
  `;
  const rules = parseRobotsTxt(body, "URLScraper");
  assert.ok(isDisallowed(rules, "/admin/dashboard"), "disallowed path blocked");
  assert.ok(!isDisallowed(rules, "/public/page"), "other path allowed");
  assert.ok(!isDisallowed(rules, "/private/public/page"), "allow beats shorter disallow");
  assert.ok(!isDisallowed(rules, "/"), "root allowed");
});

test("parseRobotsTxt prefers a named group over the wildcard", () => {
  const body = `
    User-agent: *
    Disallow: /everything/
    User-agent: URLScraper
    Disallow: /only-this/
  `;
  const rules = parseRobotsTxt(body, "URLScraper");
  assert.ok(isDisallowed(rules, "/only-this/x"), "named group rule applies");
  assert.ok(!isDisallowed(rules, "/everything/x"), "wildcard rule does not leak in");
});

test("runRegex caps matches and handles empty matches", () => {
  const { matches, truncated } = runRegex("aaa bbb aaa", "a*", "g", 2);
  assert.equal(matches.length, 2);
  assert.ok(truncated);
  const all = runRegex("one two three", "\\w+", "g", 100);
  assert.equal(all.matches.length, 3);
  assert.ok(!all.truncated);
});

test("runRegex throws on bad pattern", () => {
  assert.throws(() => runRegex("x", "([", "g", 10));
});
