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
  assert.match(await page.text(), /<title>fitbash<\/title>/);
  for (const path of ["/app.js", "/lib/pipeline.js", "/lib/providers/gemini.js", "/vendor/anthropic-sdk.js"]) {
    const res = await fetch(origin + path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get("content-type"), /text\/javascript/, path);
  }
  assert.match((await fetch(origin + "/style.css")).headers.get("content-type"), /text\/css/);
});

test("the page works from a subfolder on a static host", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  // GitHub Pages serves the site under /<repository>/, so nothing may be root-relative.
  assert.deepEqual(html.match(/(?:src|href)="\/[^"]*"/g), null);
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /script-src 'self'/);
  // The page may talk only to itself and the three AI providers.
  const connect = html.match(/connect-src ([^;]+);/)[1].split(" ");
  assert.deepEqual(connect, [
    "'self'",
    "https://generativelanguage.googleapis.com",
    "https://api.openai.com",
    "https://api.anthropic.com",
  ]);

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
