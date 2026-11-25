import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createApp } from "../server.js";
import { loadConfig } from "../src/config.js";
import { ProviderError } from "../src/providers/errors.js";

async function start(t, env = {}, deps = {}) {
  const app = createApp(loadConfig(env), { critic: null, ...deps });
  const server = http.createServer(app).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

const item = { mimeType: "image/jpeg", data: Buffer.from("shirt").toString("base64"), label: "frog tee" };

function post(origin, path, body, headers = {}) {
  return fetch(origin + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function events(res) {
  return (await res.text()).trim().split("\n").map((line) => JSON.parse(line));
}

test("the page and its assets are served with a strict content policy", async (t) => {
  const origin = await start(t);
  const page = await fetch(origin + "/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(await page.text(), /<title>fitbash<\/title>/);
  assert.equal((await fetch(origin + "/app.js")).status, 200);
  assert.equal((await fetch(origin + "/style.css")).status, 200);
});

test("files outside the public folder are not served", async (t) => {
  const origin = await start(t);
  for (const path of ["/../package.json", "/..%2Fpackage.json", "/%2e%2e/server.js", "/nope.txt"]) {
    const res = await new Promise((resolve, reject) => {
      // Raw request: fetch() would tidy the dot segments away before sending.
      http.get(origin + path, { path }, resolve).on("error", reject);
    });
    res.resume();
    assert.equal(res.statusCode, 404, path);
  }
});

test("config describes the setup without exposing keys", async (t) => {
  const origin = await start(t, { GEMINI_API_KEY: "secret-g", OPENAI_API_KEY: "secret-o", FITBASH_ACCESS_CODE: "letmein" });
  const text = await (await fetch(origin + "/api/config")).text();
  const config = JSON.parse(text);
  assert.equal(config.provider, "mock");
  assert.equal(config.check, false);
  assert.equal(config.maxAttempts, 1);
  assert.equal(config.needsCode, true);
  assert.deepEqual(config.styles.map((s) => s.id), ["flatlay", "mannequin", "model"]);
  assert.doesNotMatch(text, /secret|letmein/);
});

test("generate streams progress events and ends with the picture", async (t) => {
  const origin = await start(t);
  const res = await post(origin, "/api/generate", { items: [item, item], style: "model", fillGaps: true, notes: "tucked" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /ndjson/);
  const list = await events(res);
  assert.deepEqual(list.map((e) => e.type), ["generating", "image", "done"]);
  assert.equal(list[1].image.mimeType, "image/svg+xml");
});

test("the check and redo loop runs through the server", async (t) => {
  const prompts = [];
  const provider = { name: "fake", generate: async ({ prompt }) => (prompts.push(prompt), { mimeType: "image/png", data: "AAAA" }) };
  const reviews = [
    { status: "reviewed", verdict: "fail", score: 3, items: [], otherProblems: "", fix: "Item 1: fix the print." },
    { status: "reviewed", verdict: "pass", score: 9, items: [], otherProblems: "", fix: "" },
  ];
  const critic = { review: async () => reviews.shift() };
  const origin = await start(t, { FITBASH_MAX_ATTEMPTS: "3" }, { provider, critic });

  const list = await events(await post(origin, "/api/generate", { items: [item] }));
  assert.deepEqual(list.map((e) => e.type), [
    "generating", "image", "checking", "review",
    "generating", "image", "checking", "review",
    "done",
  ]);
  assert.match(prompts[1], /Item 1: fix the print\./);
  assert.deepEqual(list.at(-1), { type: "done", best: 2, attempts: 2 });
});

test("a provider failure is reported as an error event", async (t) => {
  const provider = { name: "fake", generate: async () => { throw new ProviderError("Gemini rejected the API key."); } };
  const origin = await start(t, {}, { provider });
  const list = await events(await post(origin, "/api/generate", { items: [item] }));
  assert.deepEqual(list.at(-1), { type: "error", message: "Gemini rejected the API key." });
});

test("bad generate requests are refused with a reason", async (t) => {
  const origin = await start(t);
  const cases = [
    [{ items: [] }, /at least one/],
    [{ items: Array(9).fill(item) }, /at most 8/],
    [{ items: [{ ...item, mimeType: "image/svg+xml" }] }, /Item 1 isn't a usable picture/],
    [{ items: [{ ...item, data: "not base64!" }] }, /too large or damaged/],
  ];
  for (const [body, pattern] of cases) {
    const res = await post(origin, "/api/generate", body);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, pattern);
  }
  const res = await fetch(origin + "/api/generate", { method: "POST", body: "{nope" });
  assert.equal(res.status, 400);
});

test("with an access code set, the API needs it and the page does not", async (t) => {
  const origin = await start(t, { FITBASH_ACCESS_CODE: "letmein" });
  assert.equal((await fetch(origin + "/")).status, 200);
  assert.equal((await post(origin, "/api/generate", { items: [item] })).status, 401);
  assert.equal((await post(origin, "/api/generate", { items: [item] }, { "x-fitbash-code": "wrong" })).status, 401);
  assert.equal((await post(origin, "/api/extract", { url: "https://example.com" })).status, 401);
  assert.equal((await fetch(origin + "/api/image?url=https://example.com/a.png")).status, 401);
  assert.equal((await post(origin, "/api/generate", { items: [item] }, { "x-fitbash-code": "letmein" })).status, 200);
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

  const open = await start(t, {}, { fetchOptions: { allowPrivate: true } });
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

test("unknown API routes and wrong methods are refused", async (t) => {
  const origin = await start(t);
  assert.equal((await fetch(origin + "/api/nope")).status, 404);
  assert.equal((await fetch(origin + "/api/generate")).status, 404);
  assert.equal((await fetch(origin + "/", { method: "POST" })).status, 405);
});
