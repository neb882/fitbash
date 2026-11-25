import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, readdir } from "node:fs/promises";

import { createApp } from "../server.js";

async function start(t, options) {
  const server = http.createServer(createApp(options)).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

function post(origin, path, body) {
  return fetch(origin + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("the page and its modules are served", async (t) => {
  const origin = await start(t);
  const page = await fetch(origin + "/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.match(await page.text(), /<title>fitbash\b/);
  for (const path of ["/app.js", "/lib/pipeline.js", "/lib/providers/gemini.js", "/vendor/anthropic-sdk.js"]) {
    const res = await fetch(origin + path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get("content-type"), /text\/javascript/, path);
  }
  assert.match((await fetch(origin + "/style.css")).headers.get("content-type"), /text\/css/);
  assert.equal((await fetch(origin + "/fonts/instrument-serif-regular.woff2")).headers.get("content-type"), "font/woff2");
});

test("the page works from a subfolder on a static host", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  // GitHub Pages serves the site under /<repository>/, so nothing may be root-relative.
  assert.deepEqual(html.match(/(?:src|href)="\/[^"]*"/g), null);
  // The whole policy, directive by directive: anything added or loosened has to be changed here too.
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
  const directives = Object.fromEntries(
    policy.split(";").map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
  assert.deepEqual(directives, {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "style-src": ["'self'"],
    // Pictures may come from anywhere secure: a visitor can paste a link to one.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    // Requests may go only to the page's own site, the three AI providers, and an app on the visitor's own computer.
    "connect-src": [
      "'self'",
      "https://generativelanguage.googleapis.com",
      "https://api.openai.com",
      "https://api.anthropic.com",
      "http://localhost:*",
      "http://127.0.0.1:*",
    ],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
  });

  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.deepEqual(app.match(/fetch\(\s*["'`]\/[^"'`]*/g), null);
});

test("browser code doesn't depend on Node", async () => {
  const dir = new URL("../public/lib/", import.meta.url);
  const files = (await readdir(dir, { recursive: true })).filter((name) => name.endsWith(".js"));
  assert.ok(files.length >= 8);
  for (const name of files) {
    const source = await readFile(new URL(name, dir), "utf8");
    assert.doesNotMatch(source, /\bBuffer\b|\bprocess\.|from "node:|require\(/, name);
  }
});

test("files outside the public folder are not served", async (t) => {
  const origin = await start(t);
  for (const path of ["/../package.json", "/..%2Fpackage.json", "/%2e%2e/server.js", "/lib/../../server.js", "/nope.txt"]) {
    const res = await new Promise((resolve, reject) => {
      // Raw request: fetch() would tidy the dot segments away before sending.
      http.get(origin + path, { path }, resolve).on("error", reject);
    });
    res.resume();
    assert.equal(res.statusCode, 404, path);
  }
});

test("the helper announces link lookup", async (t) => {
  const origin = await start(t);
  assert.deepEqual(await (await fetch(origin + "/api/config")).json(), { links: true });
});

test("links are looked up and pictures proxied, but private addresses are refused", async (t) => {
  const shop = http
    .createServer((req, res) => {
      if (req.url === "/p") {
        return res.writeHead(200, { "content-type": "text/html" }).end('<title>Jacket</title><meta property="og:image" content="/j.png">');
      }
      res.writeHead(200, { "content-type": "image/png" }).end("PNGDATA");
    })
    .listen(0, "127.0.0.1");
  await new Promise((resolve) => shop.once("listening", resolve));
  t.after(() => shop.close());
  const shopOrigin = `http://127.0.0.1:${shop.address().port}`;

  const open = await start(t, { fetchOptions: { allowPrivate: true } });
  const found = await (await post(open, "/api/extract", { url: `${shopOrigin}/p` })).json();
  assert.deepEqual(found, { title: "Jacket", candidates: [{ url: `${shopOrigin}/j.png`, source: "preview image" }] });
  const image = await fetch(`${open}/api/image?url=${encodeURIComponent(found.candidates[0].url)}`);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(await image.text(), "PNGDATA");

  const guarded = await start(t);
  const refused = await post(guarded, "/api/extract", { url: `${shopOrigin}/p` });
  assert.equal(refused.status, 422);
  assert.equal((await refused.json()).code, "blocked_address");
  assert.equal((await fetch(`${guarded}/api/image?url=${encodeURIComponent(shopOrigin + "/j.png")}`)).status, 422);
});

test("bad requests, unknown routes and wrong methods are refused", async (t) => {
  const origin = await start(t);
  assert.equal((await post(origin, "/api/extract", {})).status, 400);
  assert.equal((await fetch(origin + "/api/extract", { method: "POST", body: "{nope" })).status, 400);
  assert.equal((await fetch(origin + "/api/extract", { method: "POST", body: "x".repeat(70_000) })).status, 413);
  assert.equal((await fetch(origin + "/api/nope")).status, 404);
  assert.equal((await fetch(origin + "/api/generate", { method: "POST" })).status, 404);
  assert.equal((await fetch(origin + "/", { method: "POST" })).status, 405);
});

test("a page the lookup cannot make sense of is answered with what to do instead", async (t) => {
  // An unexpected failure deep in the lookup, stood in for by a check that throws.
  const broken = await start(t, { fetchOptions: { isBlocked: () => { throw new TypeError("unexpected"); } } });
  const res = await post(broken, "/api/extract", { url: "http://203.0.113.9/jacket" });
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /Copy the picture and paste it/);
});
