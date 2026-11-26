// The page, driven in a real browser the way a visitor uses it.
//
// The three AI services are stood in for by canned answers, so these tests need
// no keys and reach nothing outside this machine. The page is served from a
// subfolder with no helper, the way GitHub Pages serves it, except where a test
// says it is about the local helper.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { chromium, devices } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

import { createApp } from "../../server.js";

// ---- synthetic pictures ----------------------------------------------------

function png(width, height, paint) {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(paint(x / width, y / height), y * row + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits per channel, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A block of one color with a dot of another: enough to stand for "a tee with a print".
const garment = (color, dot) => (x, y) =>
  Math.hypot(x - 0.5, y - 0.4) < 0.12 ? dot : x > 0.2 && x < 0.8 && y > 0.15 && y < 0.9 ? color : [255, 255, 255];

const GREEN = [47, 111, 79];
const BLUE = [52, 80, 122];
const YELLOW = [242, 193, 78];
const RED = [192, 57, 43];

const file = (name, buffer) => ({ name, mimeType: "image/png", buffer });
const TEE = file("tee.png", png(300, 300, garment(GREEN, YELLOW)));
const JEANS = file("jeans.png", png(300, 360, garment(BLUE, BLUE)));
const BIG_TEE = file("big-tee.png", png(2400, 2400, garment(GREEN, YELLOW)));
const OUTFIT_WRONG = png(256, 384, garment(GREEN, RED)).toString("base64");
const OUTFIT_RIGHT = png(256, 384, garment(GREEN, YELLOW)).toString("base64");

// ---- servers and browser ---------------------------------------------------

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "*",
};

let browser;
let staticSite; // the page under /fitbash/, with no helper: what GitHub Pages serves
let helperSite; // the page from the local helper, allowed to reach the fake shop
let shop;

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler).listen(0, "127.0.0.1", () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });

  const files = createApp();
  staticSite = await listen((req, res) => {
    if (!req.url.startsWith("/fitbash/") || req.url.startsWith("/fitbash/api/")) return res.writeHead(404).end();
    req.url = req.url.slice("/fitbash".length);
    files(req, res);
  });

  shop = await listen((req, res) => {
    if (req.url === "/jeans") {
      return res
        .writeHead(200, { "content-type": "text/html" })
        .end('<meta property="og:title" content="Blue jeans"><meta property="og:image" content="/jeans.png"><img src="/tee.png">');
    }
    if (req.url === "/guarded") return res.writeHead(403).end("Access denied");
    res.writeHead(200, { "content-type": "image/png" }).end(req.url === "/tee.png" ? TEE.buffer : JEANS.buffer);
  });
  helperSite = await listen(createApp({ fetchOptions: { allowPrivate: true } }));
});

after(async () => {
  await browser?.close();
  for (const site of [staticSite, helperSite, shop]) site?.server.close();
});

/**
 * Open the page with stand-ins for the three services. `services` steers their
 * answers and collects what the page sent them.
 */
async function open(t, { url = `${staticSite.origin}/fitbash/`, context = {}, services = {}, init } = {}) {
  // Motion is off unless a test asks for it: the page glides to the outfit when one is made, and a press
  // sent while it is still gliding can land on the wrong thing.
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce", ...context });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000); // A page that never comes up should fail a test quickly, not hang it.
  const seen = { errors: [], failed: [], google: [], openai: [], openrouter: [], signIns: [], claude: [], local: [] };
  page.on("pageerror", (error) => seen.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) seen.errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).hostname === "127.0.0.1") {
      seen.failed.push(new URL(response.url()).pathname);
    }
  });

  const json = (route, status, body) =>
    route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
  const preflight = (route) => route.fulfill({ status: 204, headers: CORS });

  await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return preflight(route);
    const key = request.headers()["x-goog-api-key"];
    if (request.method() === "GET") {
      return key === "GOOD-KEY"
        ? json(route, 200, { models: [] })
        : json(route, 400, { error: { message: "API key not valid. Please pass a valid API key." } });
    }
    seen.google.push({ key, body: request.postDataJSON() });
    if (services.googleDelay) await new Promise((resolve) => setTimeout(resolve, services.googleDelay));
    if (services.googleError) return json(route, ...services.googleError);
    const picture = (services.pictures ?? [OUTFIT_RIGHT])[seen.google.length - 1] ?? OUTFIT_RIGHT;
    json(route, 200, { steps: [{ type: "model_output", content: [{ type: "image", data: picture }] }] });
  });

  await page.route("https://api.openai.com/**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return preflight(route);
    if (request.method() === "GET") return json(route, 200, { data: [] });
    const raw = request.postDataBuffer().toString("latin1");
    seen.openai.push({
      authorization: request.headers()["authorization"],
      model: /name="model"\r\n\r\n([^\r]+)/.exec(raw)?.[1],
      pictures: raw.match(/name="image\[\]"/g)?.length ?? 0,
    });
    if (services.openaiError) return json(route, ...services.openaiError);
    json(route, 200, { data: [{ b64_json: OUTFIT_RIGHT }] });
  });

  await page.route("https://openrouter.ai/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return preflight(route);
    // The sign-in page: stands in for a visitor who signs in and approves at once.
    if (url.pathname === "/auth") {
      seen.signIns.push(Object.fromEntries(url.searchParams));
      const back = new URL(url.searchParams.get("callback_url"));
      back.searchParams.set("code", "ONE-TIME");
      return route.fulfill({ status: 302, headers: { location: back.href } });
    }
    // The trade of the one-time code for a key, honoured only with the secret whose fingerprint started the sign-in.
    if (url.pathname === "/api/v1/auth/keys") {
      const body = request.postDataJSON();
      const fingerprint = createHash("sha256").update(String(body.code_verifier)).digest("base64url");
      const honoured = !services.signInFails && body.code === "ONE-TIME" && seen.signIns.at(-1)?.code_challenge === fingerprint;
      return honoured ? json(route, 200, { key: "GOOD-OR" }) : json(route, 400, { error: { message: "Invalid code", code: 400 } });
    }
    const authorization = request.headers()["authorization"];
    if (url.pathname === "/api/v1/key") {
      return authorization === "Bearer GOOD-OR"
        ? json(route, 200, { data: { label: "fitbash", limit_remaining: null } })
        : json(route, 401, { error: { message: "User not found.", code: 401 } });
    }
    if (url.pathname === "/api/v1/images") {
      seen.openrouter.push({ authorization, body: request.postDataJSON() });
      if (services.openrouterError) return json(route, ...services.openrouterError);
      return json(route, 200, { data: [{ b64_json: OUTFIT_RIGHT, media_type: "image/png" }] });
    }
    route.fulfill({ status: 404, headers: CORS, body: "" });
  });

  await page.route("https://api.anthropic.com/**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return preflight(route);
    const authorization = request.headers()["authorization"];
    if (request.method() === "GET") {
      return authorization === "Bearer GOOD-CLAUDE"
        ? json(route, 200, { data: [], has_more: false, first_id: null, last_id: null })
        : json(route, 401, { type: "error", error: { type: "authentication_error", message: "invalid key" } });
    }
    seen.claude.push({ authorization, body: request.postDataJSON() });
    const verdict = (services.verdicts ?? [])[seen.claude.length - 1] ?? PASS;
    json(route, 200, {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "stand-in",
      content: [{ type: "text", text: JSON.stringify(verdict) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });

  // The app on the visitor's own computer. `services.local` is read on every request, so a
  // test can install the app, make it refuse the website, or change its models as it goes.
  await page.route(/^http:\/\/(localhost:13305|127\.0\.0\.1:1234)\//, (route) => {
    const request = route.request();
    const local = services.local;
    if (!local) return route.abort("connectionrefused");
    // A real browser hides a cross-site refusal: the page's request simply fails. Only a
    // request that asks to read nothing (no-cors) gets through, which is how the page tells
    // "refusing" from "not there".
    // (The browser sends an Origin header only with the kind of request that may read the answer.)
    if (local.refuse) {
      return request.headers()["origin"] ? route.abort("failed") : route.fulfill({ status: 403, body: "" });
    }
    if (request.method() === "OPTIONS") return preflight(route);
    const path = new URL(request.url()).pathname;
    if (path === "/v1/models") return json(route, 200, { object: "list", data: local.catalog });
    if (path === "/v1/pull") {
      const body = request.postDataJSON();
      const name = body.model_name;
      seen.local.push({ pull: name });
      // Only a download the app is asked to look after itself is answered at once. Any other
      // kind is tied to its request, which stays open for as long as the download takes.
      if (body.stream !== true || body.subscribe !== false) return;
      if (local.refusePull) return json(route, 400, { error: { message: "Server is offline", code: "lemond_offline" } });
      const gigabytes = local.catalog.find((model) => model.id === name)?.size ?? 0;
      local.job = { model: name, status: "downloading", done: 0, total: 0, size: gigabytes * 1e9, reads: 0 };
      return json(route, 200, jobSnapshot(local.job));
    }
    if (path === "/v1/downloads") {
      const job = local.job;
      if (!job) return json(route, 200, []);
      // The app learns the size once the download is under way, then counts up.
      if (job.status === "downloading") {
        job.reads += 1;
        job.total = job.size;
        job.done = Math.min(job.total, (local.startsAt ?? 0) + (job.reads - 1) * (local.bytesPerRead ?? 0));
        // An app that accepts the download and then fails it some seconds in.
        if (local.pullFails && job.reads > 1) Object.assign(job, { status: "error", error: "disk full" });
      }
      // The app lists downloads of its own parts beside the models.
      const part = { ...jobSnapshot(job), id: "backend:sd-cpp:vulkan", type: "backend", model_name: "sd-cpp:vulkan", status: "completed" };
      return json(route, 200, [part, jobSnapshot(job)]);
    }
    if (path === "/v1/images/edits") {
      const raw = request.postDataBuffer().toString("latin1");
      const field = (name) => new RegExp(`name="${name}"\r\n\r\n([^\r]+)`).exec(raw)?.[1];
      seen.local.push({ model: field("model"), size: field("size"), pictures: raw.match(/name="image\[\]"/g)?.length ?? 0 });
      // The picture engine inside the app fails: the app passes the engine's reason along in the details.
      if (local.engineError) {
        return json(route, 500, {
          error: { message: "sd-server request failed", type: "backend_error", details: { status_code: 500, response: { error: local.engineError } } },
        });
      }
      return json(route, 200, { created: 1, data: [{ b64_json: OUTFIT_RIGHT }], output_format: "png" });
    }
    route.fulfill({ status: 404, headers: CORS, body: "" });
  });

  for (const [pictureUrl, handler] of Object.entries(services.web ?? {})) await page.route(pictureUrl, handler);

  t.after(() => ctx.close());
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);
  return { page, seen };
}

// A download job as Lemonade documents it (2026-11): /v1/pull answers one at once, /v1/downloads lists them.
const jobSnapshot = (job) => ({
  id: `model:${job.model}`,
  type: "model",
  model_name: job.model,
  status: job.status,
  running: job.status === "downloading",
  file: "model.safetensors",
  file_index: 1,
  total_files: 1,
  bytes_downloaded: job.done,
  bytes_total: job.total,
  percent: job.total ? Math.floor((job.done / job.total) * 100) : 0,
  total_download_size: job.total,
  bytes_previously_downloaded: 0,
  completed_files_bytes: 0,
  cumulative_bytes_downloaded: job.done,
  overall_bytes_downloaded: job.done,
  complete: job.status === "completed",
  ...(job.error ? { error: job.error } : {}),
});

/** The stand-in app finishes its download: the job says so and the model is listed as there. */
function finishDownload(local) {
  Object.assign(local.job, { status: "completed", done: local.job.total });
  local.catalog = local.catalog.map((model) => (model.id === local.job.model ? { ...model, downloaded: true } : model));
}

const PASS = {
  items: [{ number: 1, present: true, faithful: true, problem: "" }],
  other_problems: "",
  score: 9,
  verdict: "pass",
  fix_instructions: "",
};
const FAIL = {
  items: [{ number: 1, present: true, faithful: false, problem: "the print is red, not yellow" }],
  other_problems: "",
  score: 4,
  verdict: "fail",
  fix_instructions: "Item 1: the print must be yellow.",
};

// What the local app lists, in the shape its documentation gives.
const localCatalog = () => [
  { id: "SD-Turbo", size: 5.21, downloaded: true, labels: ["image"] },
  { id: "Flux-2-Klein-9B-GGUF", size: 19, downloaded: false, labels: ["image", "edit"], recipe: "sd-cpp", recipe_options: { steps: 4 } },
  { id: "Flux-2-Klein-4B", size: 16.1, downloaded: false, labels: ["image", "edit"], recipe: "sd-cpp", recipe_options: { steps: 4 } },
];

const text = (page, selector) => page.textContent(selector);
const untilText = (page, selector, part) =>
  page.waitForFunction(([s, p]) => document.querySelector(s).textContent.includes(p), [selector, part]);
const addFiles = async (page, files) => {
  const before = await page.locator(".item").count();
  await page.setInputFiles("#files", files);
  await page.waitForFunction((n) => document.querySelectorAll(".item").length >= n, Math.min(8, before + [].concat(files).length));
};
const cards = (page) =>
  page.$$eval(".attempt", (nodes) => nodes.map((node) => node.querySelector(".notes").innerText.replace(/\s*\n\s*/g, " | ")));
const sizeOf = (page, base64) =>
  page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${data}`;
    await img.decode();
    return `${img.width}x${img.height}`;
  }, base64);
const options = { timeout: 90_000 };

// ---- tests -----------------------------------------------------------------

test("a first visit on a static host shows the setup steps and gives a collage until a key is connected", options, async (t) => {
  const { page, seen } = await open(t);

  assert.equal(await page.evaluate(() => document.querySelector("#settings").open), true);
  assert.match(await text(page, "#settings-summary"), /Do this once/);
  const steps = await page.$$eval(".steps li", (nodes) => nodes.map((node) => node.innerText.replace(/\s+/g, " ").trim()));
  assert.match(steps[0], /Open Google's key page.*sign in/);
  assert.match(steps[1], /Create API key/);
  assert.match(steps[2], /Paste the key here/);
  assert.equal(await page.getAttribute("#provider-key-link", "href"), "https://aistudio.google.com/apikey");
  assert.equal(await page.isDisabled("#generate"), true);

  await addFiles(page, [TEE, JEANS]);
  assert.equal(await text(page, "#count"), "2 of 8");
  await page.click("#generate");
  await untilText(page, "#progress", "only a collage");
  assert.match(await page.getAttribute(".attempt img", "src"), /^data:image\/svg\+xml;base64,/);
  assert.equal(seen.google.length + seen.openai.length + seen.claude.length, 0);

  // An unstamped copy of the site (this one, and anyone's local copy) registers no service worker.
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
  assert.equal(await page.isHidden("#update-notice"), true);

  // Only the probe for the local helper may fail; every script, style and module must load from the subfolder.
  assert.deepEqual(seen.failed, ["/fitbash/api/config"]);
  assert.deepEqual(seen.errors, []);
});

test("a pasted key is checked at once, remembered, and forgotten on request", options, async (t) => {
  const { page, seen } = await open(t);

  await page.fill("#provider-key", "WRONG");
  await untilText(page, "#provider-key-status", "wasn't accepted");
  await page.fill("#provider-key", "GOOD-KEY");
  await untilText(page, "#provider-key-status", "This key works");
  assert.equal(await text(page, "#settings-summary"), "Google Gemini connected");

  await page.click(".sub summary");
  await page.fill("#claude-key", "nope");
  await untilText(page, "#claude-key-status", "wasn't accepted");
  await page.fill("#claude-key", "GOOD-CLAUDE");
  await untilText(page, "#claude-key-status", "This key works");
  assert.equal(await text(page, "#settings-summary"), "Google Gemini connected, double-check on");

  // The other service has its own, empty key box and its own instructions.
  await page.click('#providers input[value="openai"]', { force: true });
  assert.equal(await page.inputValue("#provider-key"), "");
  assert.equal(await text(page, "#provider-key-status"), "");
  assert.equal(await page.getAttribute("#provider-key-link", "href"), "https://platform.openai.com/api-keys");
  assert.match(await text(page, "#provider-note"), /credit and verified your identity/);
  await page.click('#providers input[value="gemini"]', { force: true });

  await page.reload();
  await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);
  assert.equal(await page.evaluate(() => document.querySelector("#settings").open), false);
  assert.equal(await page.inputValue("#provider-key"), "GOOD-KEY");

  await page.click("#settings > summary");
  await page.click("#forget");
  assert.equal(await page.inputValue("#provider-key"), "");
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("fitbash-settings")));
  assert.deepEqual([stored.geminiKey, stored.openaiKey, stored.claudeKey], ["", "", ""]);
  assert.deepEqual(seen.errors, []);
});

test("a picture is made, checked against the pieces, and redone once with the check's notes", options, async (t) => {
  const { page, seen } = await open(t, { services: { pictures: [OUTFIT_WRONG, OUTFIT_RIGHT], verdicts: [FAIL, PASS] } });
  await page.fill("#provider-key", "GOOD-KEY");
  await page.click(".sub summary");
  await page.fill("#claude-key", "GOOD-CLAUDE");

  await addFiles(page, BIG_TEE);
  await page.fill(".item input", "frog tee");
  await page.check('input[name="style"][value="model"]', { force: true });
  await page.fill("#notes", "tucked in");
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");

  assert.deepEqual(await cards(page), [
    "Second try | Matches your pieces · 9/10 | Best match | Save picture",
    "First try | Off in places · 4/10 | frog tee: the print is red, not yellow | Save picture",
  ]);

  // The image model gets the full-size piece; the check gets the smaller, cheaper copy.
  const [first, second] = seen.google;
  assert.equal(first.key, "GOOD-KEY");
  assert.deepEqual(first.body.input.map((part) => part.type), ["text", "image"]);
  assert.deepEqual(first.body.response_format, { type: "image", aspect_ratio: "3:4" });
  assert.match(first.body.input[0].text, /1\. frog tee[\s\S]*tucked in/);
  assert.equal(await sizeOf(page, first.body.input[1].data), "1536x1536");
  assert.match(second.body.input[0].text, /earlier attempt[\s\S]*Item 1: the print must be yellow\./);

  assert.equal(seen.claude.length, 2);
  const check = seen.claude[0];
  assert.equal(check.authorization, "Bearer GOOD-CLAUDE");
  assert.equal(check.body.fallbacks, "default");
  const pictures = check.body.messages[0].content.filter((block) => block.type === "image");
  assert.equal(pictures.length, 2);
  assert.equal(await sizeOf(page, pictures[0].source.data), "1024x1024");
  assert.deepEqual(seen.errors, []);
});

test("without a Claude key one picture is made and nothing is sent to the check", options, async (t) => {
  const { page, seen } = await open(t);
  await page.fill("#provider-key", "GOOD-KEY");
  await addFiles(page, [TEE, JEANS]);
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  assert.deepEqual(await cards(page), ["Save picture"]);
  assert.equal(seen.google.length, 1);
  assert.equal(seen.google[0].body.input.filter((part) => part.type === "image").length, 2);
  assert.equal(seen.claude.length, 0);
});

test("a service's refusal is explained with what to do next", options, async (t) => {
  // Google's real answer to a picture request on a key with no billing (2026-11-25).
  const billing = [429, { error: { message: "Rate limit exceeded for model gemini-nano-banana-2.1 (limit: 0 requests per day on Free Tier). Please upgrade your tier at https://ai.dev/rate-limit.", code: "too_many_requests" } }];
  const { page } = await open(t, { services: { googleError: billing } });
  await page.fill("#provider-key", "GOOD-KEY");
  await addFiles(page, TEE);
  await page.click("#generate");
  await untilText(page, "#progress", "Turn on billing for this key");
  assert.equal(await page.locator("#progress.error").count(), 1);
  assert.equal(await page.isEnabled("#generate"), true);
});

test("the other service is sent the pieces as a multipart edit, and its verification demand is explained", options, async (t) => {
  const unverified = [403, { error: { message: "Your organization must be verified to use this model." } }];
  const services = {};
  const { page, seen } = await open(t, { services });
  await page.click('#providers input[value="openai"]', { force: true });
  await page.fill("#provider-key", "OPENAI-KEY");
  await page.click(".sub:last-of-type summary");
  await page.fill("#provider-model", "renamed-model");
  await addFiles(page, [TEE, JEANS]);

  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  assert.deepEqual(seen.openai[0], { authorization: "Bearer OPENAI-KEY", model: "renamed-model", pictures: 2 });

  services.openaiError = unverified;
  await page.click("#generate");
  await untilText(page, "#progress", "identity verified");
});

test("on a static host a link must point at a picture, and the page says so for anything else", options, async (t) => {
  const web = {
    "https://cdn.example.test/tee.png": (route) =>
      route.fulfill({ status: 200, headers: { ...CORS, "content-type": "image/png" }, body: TEE.buffer }),
    "https://shop.example.test/**": (route) =>
      route.fulfill({ status: 200, headers: { "content-type": "text/html" }, body: "<html>a product page</html>" }),
  };
  const { page, seen } = await open(t, { services: { web } });
  assert.match(await page.getAttribute("#link", "placeholder"), /link to a picture/);

  await page.fill("#link", "https://cdn.example.test/tee.png");
  await page.click("#link-form button");
  await page.waitForSelector(".item");
  assert.equal(await page.inputValue("#link"), "");

  await page.fill("#link", "https://shop.example.test/jacket");
  await page.click("#link-form button");
  await untilText(page, "#add-status", "can't read shop pages");
  assert.equal(await page.locator(".item").count(), 1);
  assert.deepEqual(seen.errors, []);
});

test("with the local helper a pasted shop link offers the page's pictures", options, async (t) => {
  const { page, seen } = await open(t, { url: `${helperSite.origin}/` });
  assert.match(await text(page, "#empty"), /Shop links work too/);

  await page.evaluate((link) => {
    const data = new DataTransfer();
    data.setData("text/plain", link);
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, `${shop.origin}/jeans`);
  await page.waitForSelector("#picker:not([hidden]) button img");
  assert.equal(await page.locator("#picker-list button").count(), 2);
  await page.click("#picker-list button");
  await page.waitForSelector(".item");
  assert.equal(await page.inputValue(".item input"), "Blue jeans");
  assert.equal(await page.isHidden("#picker"), true);

  await page.fill("#link", `${shop.origin}/guarded`);
  await page.click("#link-form button");
  await untilText(page, "#add-status", "blocks automated visits");
  assert.deepEqual(seen.failed, ["/api/extract"]);
  assert.deepEqual(seen.errors, []);
});

test("a picture pasted from the clipboard is added, and an outfit stops at eight pieces", options, async (t) => {
  const { page } = await open(t);
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "clip.png", { type: "image/png" }));
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, TEE.buffer.toString("base64"));
  await page.waitForSelector(".item");

  await addFiles(page, Array(8).fill(JEANS));
  await untilText(page, "#add-status", "at most 8 pieces");
  assert.equal(await page.locator(".item").count(), 8);

  await page.click(".item:first-child .remove");
  assert.equal(await text(page, "#count"), "7 of 8");
});

test("the page fits a phone and tells touch users what to tap", options, async (t) => {
  const services = { verdicts: [FAIL, PASS], local: { catalog: localCatalog() } };
  const { page } = await open(t, { context: devices["Pixel 7"], services });
  assert.match(await text(page, "#empty"), /Tap “Add pictures”/);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(await overflow(), 0, "with setup open");

  // The "this computer" steps carry the longest labels: a model's name with its size.
  await page.click('#providers input[value="local"]', { force: true });
  await page.click("#local-connect");
  await page.waitForSelector("#local-models:not([hidden])");
  assert.equal(await overflow(), 0, "with the local models listed");
  services.local.refuse = true;
  await page.click("#local-connect");
  await page.waitForSelector("#local-allow:not([hidden])");
  assert.equal(await overflow(), 0, "with the allow-this-website steps showing");
  await page.click('#providers input[value="gemini"]', { force: true });

  await page.fill("#provider-key", "GOOD-KEY");
  await page.click(".sub summary");
  await page.fill("#claude-key", "GOOD-CLAUDE");
  await addFiles(page, [TEE, JEANS]);
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  assert.equal(await page.locator(".attempt").count(), 2);
  assert.equal(await overflow(), 0, "with results showing");
});

test("a free model on the visitor's own computer: connect, download the suggested model, make a picture", options, async (t) => {
  const services = { local: { catalog: localCatalog() } };
  const { page, seen } = await open(t, { services });

  await page.click('#providers input[value="local"]', { force: true });
  assert.equal(await page.isHidden("#key-setup"), true);
  assert.equal(await page.isVisible("#local-setup"), true);
  assert.equal(await page.getAttribute("#local-app-link", "href"), "https://lemonade-server.ai");

  await page.selectOption("#local-tier", "small");
  assert.match(await text(page, "#local-advice"), /standard model may just fit/);

  await page.click("#local-connect");
  await untilText(page, "#local-status", "has to be downloaded first (16.1 GB)");
  // Only the models that can combine pictures are offered, the one that fits this computer first.
  assert.deepEqual(
    await page.$$eval("#local-model option", (nodes) => nodes.map((node) => node.value)),
    ["Flux-2-Klein-9B-GGUF", "Flux-2-Klein-4B"],
  );
  assert.equal(await page.inputValue("#local-model"), "Flux-2-Klein-4B");
  assert.match(await text(page, "#settings-summary"), /Do this once/);

  // The app downloads at 100 megabits a second: 25 MB between two looks, two seconds apart.
  Object.assign(services.local, { startsAt: 3_200_000_000, bytesPerRead: 25_000_000 });
  assert.equal(await page.isHidden("#local-progress"), true);
  await page.click("#local-download");
  await untilText(page, "#local-status", "Downloading 16.1 GB. Keep Lemonade open");
  assert.equal(await page.isHidden("#local-download"), true);
  // How far, how fast and how long to go, from what the app reports.
  await page.waitForFunction(() => document.querySelector("#local-progress-text").textContent.includes("Mbps"));
  const readout = /^3\.2 of 16\.1 GB \((?:19|20)%\) · (\d+) Mbps · about (\d+) minutes left$/.exec(await text(page, "#local-progress-text"));
  assert.ok(readout, await text(page, "#local-progress-text"));
  assert.ok(readout[1] > 70 && readout[1] < 130, `about 100 Mbps, got ${readout[1]}`);
  assert.ok(readout[2] > 12 && readout[2] < 24, `about 17 minutes, got ${readout[2]}`);
  assert.match(String(await page.$eval("#local-progress-bar", (bar) => bar.value)), /^(19|20)$/);
  assert.equal(await page.isHidden("#local-progress"), false);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    0,
    "with the download readout showing",
  );

  finishDownload(services.local);
  await untilText(page, "#local-status", "Connected and ready.");
  assert.deepEqual(seen.local, [{ pull: "Flux-2-Klein-4B" }]);
  assert.equal(await page.isHidden("#local-download"), true);
  assert.equal(await page.isHidden("#local-progress"), true);
  assert.equal(await text(page, "#settings-summary"), "This computer connected");

  await addFiles(page, [TEE, JEANS]);
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  assert.deepEqual(seen.local[1], { model: "Flux-2-Klein-4B", size: "896x1152", pictures: 2 });
  assert.match(await page.getAttribute(".attempt img", "src"), /^data:image\/png;base64,/);
  assert.equal(seen.google.length + seen.openai.length + seen.claude.length, 0);

  await page.reload();
  await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);
  assert.equal(await page.evaluate(() => document.querySelector("#settings").open), false);
  assert.equal(await text(page, "#settings-summary"), "This computer connected");
  assert.deepEqual(seen.errors, []);
});

test("a missing local app says so, and one that refuses this website shows how to allow it", options, async (t) => {
  const services = {};
  const { page, seen } = await open(t, { services });
  await page.click('#providers input[value="local"]', { force: true });
  await page.selectOption("#local-tier", "large");

  await page.click("#local-connect");
  await untilText(page, "#local-status", "Couldn't find the app");
  assert.equal(await page.isHidden("#local-allow"), true);

  services.local = { refuse: true, catalog: localCatalog() };
  await page.click("#local-connect");
  await page.waitForSelector("#local-allow:not([hidden])");
  const origin = await page.evaluate(() => location.origin);
  assert.equal(await text(page, "#local-allow-command"), `lemonade config set allowed_origins="${origin}"`);
  assert.equal(await page.isHidden("#local-models"), true);

  services.local.refuse = false;
  services.local.catalog = localCatalog().map((model) => ({ ...model, downloaded: true }));
  await page.click("#local-connect");
  await untilText(page, "#local-status", "Connected and ready.");
  assert.equal(await page.isHidden("#local-allow"), true);
  // A computer with a large graphics card is offered the larger model.
  assert.equal(await page.inputValue("#local-model"), "Flux-2-Klein-9B-GGUF");

  // Choosing a paid service again brings its key steps back.
  await page.click('#providers input[value="gemini"]', { force: true });
  assert.equal(await page.isVisible("#key-setup"), true);
  assert.equal(await page.isHidden("#local-setup"), true);
  assert.deepEqual(seen.errors, []);
});

const reloaded = async (page) => {
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);
};
const pastOutfits = (page) =>
  page.$$eval(".past", (nodes) =>
    nodes.map((node) => `${node.querySelector(".past-pieces").textContent} | ${node.querySelector(".muted").textContent}`),
  );

test("outfits made here are kept in this browser, and can be looked at, reused and removed", options, async (t) => {
  const services = {};
  const { page, seen } = await open(t, { services });

  // A stand-in collage is not an outfit: nothing is kept until a real picture is made.
  await addFiles(page, [TEE, JEANS]);
  await page.fill(".item input", "frog tee");
  await page.click("#generate");
  await untilText(page, "#progress", "only a collage");
  assert.equal(await page.isHidden("#history"), true);

  await page.fill("#provider-key", "GOOD-KEY");
  await page.check('input[name="style"][value="model"]', { force: true });
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  await page.waitForSelector("#history:not([hidden]) .past");
  assert.equal((await pastOutfits(page)).length, 1);
  assert.match((await pastOutfits(page))[0], /^frog tee and 1 more \| On a model · /);

  // A run with a redo keeps one outfit, the better picture, with the check's verdict.
  services.pictures = [null, OUTFIT_WRONG, OUTFIT_RIGHT]; // the first slot was the run above
  services.verdicts = [FAIL, PASS];
  await page.click(".sub summary");
  await page.fill("#claude-key", "GOOD-CLAUDE");
  await page.check('input[name="style"][value="flatlay"]', { force: true });
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  await page.waitForFunction(() => document.querySelectorAll(".past").length === 2);
  const [newest, older] = await pastOutfits(page);
  assert.match(newest, /\| Flat lay · .* · matches your pieces$/);
  assert.match(older, /\| On a model · /);
  const keptPicture = await page.evaluate(async () => {
    const [latest] = await (await import("./lib/history.js")).listOutfits();
    return btoa(String.fromCharCode(...new Uint8Array(await latest.picture.arrayBuffer())));
  });
  assert.equal(keptPicture, OUTFIT_RIGHT);

  // They are still there after the page is closed and opened again.
  await reloaded(page);
  await page.waitForFunction(() => document.querySelectorAll(".past").length === 2);
  assert.equal(await page.locator(".item").count(), 0);

  await page.click(".past:first-child .past-picture");
  assert.equal(await page.evaluate(() => document.querySelector("#viewer").open), true);
  assert.match(await text(page, "#viewer-caption"), /^frog tee and 1 more · Flat lay/);
  await page.click("#viewer-close");
  assert.equal(await page.evaluate(() => document.querySelector("#viewer").open), false);
  assert.match(await page.getAttribute(".past:first-child .download", "href"), /^blob:/);
  assert.equal(await page.getAttribute(".past:first-child .download", "download"), "fitbash-outfit.png");

  // "Use these pieces" brings back the pieces and the look, ready to make again.
  await page.click(".past:last-child .past-actions button");
  await page.waitForFunction(() => document.querySelectorAll(".item").length === 2);
  assert.equal(await page.inputValue(".item input"), "frog tee");
  assert.equal(await page.isChecked('input[name="style"][value="model"]'), true);
  assert.match(await text(page, "#add-status"), /Loaded the 2 pieces/);
  const sentBefore = seen.google.length;
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  assert.equal(seen.google.length, sentBefore + 1);
  const again = seen.google.at(-1).body;
  assert.equal(again.input.filter((part) => part.type === "image").length, 2);
  assert.deepEqual(again.input[1], seen.google[0].body.input[1]); // the very same picture, not a re-compressed copy
  assert.equal(seen.claude.at(-1).body.messages[0].content.filter((block) => block.type === "image").length, 3);
  await page.waitForFunction(() => document.querySelectorAll(".past").length === 3);

  await page.click(".past:first-child .past-actions button:last-child");
  await page.waitForFunction(() => document.querySelectorAll(".past").length === 2);

  // Removing everything takes a second press, and takes the stored item pictures with it.
  const idsBefore = await page.evaluate(async () => (await (await import("./lib/history.js")).listOutfits()).map((o) => o.id));
  assert.equal(idsBefore.length, 2);
  await page.click("#history-clear");
  assert.equal(await text(page, "#history-clear"), "Really remove all?");
  assert.equal(await page.locator(".past").count(), 2);
  await page.click("#history-clear");
  await page.waitForSelector("#history", { state: "hidden" });
  const piecesLeft = await page.evaluate(async (ids) => {
    const history = await import("./lib/history.js");
    return (await Promise.all(ids.map((id) => history.outfitPieces(id)))).flat().length;
  }, idsBefore);
  assert.equal(piecesLeft, 0);
  await reloaded(page);
  assert.equal(await page.isHidden("#history"), true);
  assert.deepEqual(seen.errors, []);
});

test("only the newest outfits are stored, and a dropped outfit's pieces go with it", options, async (t) => {
  const { page } = await open(t);
  const result = await page.evaluate(async () => {
    const history = await import("./lib/history.js");
    const ids = [];
    for (let i = 1; i <= history.MAX_OUTFITS + 2; i++) {
      const piece = { label: `piece ${i}`, mimeType: "image/jpeg", data: "AAAA" };
      ids.push(await history.saveOutfit({ picture: new Blob(["x"]), labels: [`outfit ${i}`], style: "flatlay" }, [piece]));
    }
    await history.removeOutfit(ids.at(-2));
    const removedPieces = (await history.outfitPieces(ids.at(-2))).length;
    await history.saveOutfit({ picture: new Blob(["x"]), labels: ["outfit 27"], style: "flatlay" }, []);
    const kept = await history.listOutfits();
    return {
      removedPieces,
      max: history.MAX_OUTFITS,
      count: kept.length,
      newest: kept[0].labels[0],
      oldest: kept.at(-1).labels[0],
      droppedPieces: (await history.outfitPieces(ids[0])).length,
      keptPieces: (await history.outfitPieces(ids.at(-1))).map((piece) => piece.label),
    };
  });
  assert.deepEqual(result, {
    removedPieces: 0,
    max: 24,
    count: 24,
    newest: "outfit 27",
    oldest: "outfit 3",
    droppedPieces: 0,
    keptPieces: ["piece 26"],
  });
});

test("where the browser won't store anything, pictures are still made and the list stays away", options, async (t) => {
  const init = () => {
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new Error("storage is blocked");
      },
    });
  };
  const { page, seen } = await open(t, { init });
  await page.fill("#provider-key", "GOOD-KEY");
  await addFiles(page, TEE);
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  assert.equal(await page.locator(".attempt img").count(), 1);
  assert.equal(await page.isHidden("#history"), true);
  assert.deepEqual(seen.errors, []);
});

// An automated accessibility check (contrast, names, roles, labels) of the page's main states.
// It finds what a machine can find; it does not replace trying the page with a keyboard.
for (const scheme of ["light", "dark"]) {
  test(`the page passes automated accessibility checks in the ${scheme} colours`, options, async (t) => {
    const services = { pictures: [OUTFIT_WRONG, OUTFIT_RIGHT], verdicts: [FAIL, PASS], local: { catalog: localCatalog() } };
    // Motion off, so colours are measured as they settle and not half-way through a fade.
    const { page } = await open(t, { context: { colorScheme: scheme, reducedMotion: "reduce" }, services });
    const problems = async (state) => {
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      return violations.map((v) => `${state}: ${v.id} (${v.nodes.length}) ${v.nodes[0].target.join(" ")} — ${v.nodes[0].failureSummary.split("\n")[1]?.trim()}`);
    };
    const found = [];

    found.push(...(await problems("first visit, setup open")));

    // The notice of a newer version only appears on a deployed copy; show it here to check its colours.
    await page.evaluate(() => (document.getElementById("update-notice").hidden = false));
    found.push(...(await problems("the newer-version notice")));
    await page.click("#update-later");

    await page.click('#providers input[value="local"]', { force: true });
    await page.click("#local-connect");
    await page.waitForSelector("#local-models:not([hidden])");
    found.push(...(await problems("local model steps")));

    await page.click('#providers input[value="openrouter"]', { force: true });
    found.push(...(await problems("the one-account service, with its connect button and model list")));

    await page.click('#providers input[value="gemini"]', { force: true });
    await page.fill("#provider-key", "GOOD-KEY");
    await untilText(page, "#provider-key-status", "This key works");
    for (const summary of await page.locator(".sub summary").all()) await summary.click();
    await page.fill("#claude-key", "GOOD-CLAUDE");
    await untilText(page, "#claude-key-status", "This key works");
    found.push(...(await problems("setup filled in")));

    await page.click("#settings > summary");
    await addFiles(page, [TEE, JEANS]);
    await page.fill("#link", "not a link");
    await page.click("#link-form button");
    await page.click("#generate");
    await untilText(page, "#progress", "Your outfit is ready.");
    await page.waitForSelector(".past");
    found.push(...(await problems("results and past outfits")));

    await page.click(".past-picture");
    found.push(...(await problems("a past outfit opened larger")));

    assert.deepEqual(found, []);
  });
}

const FAIL_BETTER = { ...FAIL, score: 6 };
const FAIL_WORSE = { ...FAIL, score: 3 };

test("when no attempt passes the check, the page stops at two pictures and keeps the better one", options, async (t) => {
  const services = { pictures: [OUTFIT_RIGHT, OUTFIT_WRONG], verdicts: [FAIL_BETTER, FAIL_WORSE, PASS, PASS] };
  const { page, seen } = await open(t, { services });
  await page.fill("#provider-key", "GOOD-KEY");
  await page.click(".sub summary");
  await page.fill("#claude-key", "GOOD-CLAUDE");
  await addFiles(page, TEE);
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");

  // Each attempt is the visitor's money: two pictures and two checks, and no more.
  assert.equal(seen.google.length, 2);
  assert.equal(seen.claude.length, 2);
  // The first attempt scored higher, so it is the one shown first and the one kept.
  const shown = await cards(page);
  assert.match(shown[0], /^First try \| Off in places · 6\/10 \| Best match/);
  assert.match(shown[1], /^Second try \| Off in places · 3\/10/);
  await page.waitForSelector(".past");
  const kept = await page.evaluate(async () => {
    const [latest] = await (await import("./lib/history.js")).listOutfits();
    return btoa(String.fromCharCode(...new Uint8Array(await latest.picture.arrayBuffer())));
  });
  assert.equal(kept, OUTFIT_RIGHT);
  assert.match((await pastOutfits(page))[0], /off in places$/);
});

test("what a run reports belongs to that run, whatever is changed on the page meanwhile", options, async (t) => {
  const faultsFirst = { ...FAIL, items: [{ number: 1, present: true, faithful: false, problem: "print differs" }] };
  const services = { googleDelay: 800, verdicts: [faultsFirst, PASS] };
  const { page } = await open(t, { services });
  await page.fill("#provider-key", "GOOD-KEY");
  await page.click(".sub summary");
  await page.fill("#claude-key", "GOOD-CLAUDE");
  await addFiles(page, [TEE, JEANS]);
  await page.locator(".item input").nth(0).fill("frog tee");
  await page.locator(".item input").nth(1).fill("blue jeans");

  await page.click("#generate");
  // While the picture is being made, the first piece is removed and the keys are forgotten.
  await page.click(".item:first-child .remove");
  await page.click("#forget");
  await untilText(page, "#progress", "Your outfit is ready.");

  // The check faulted the first piece of the run, the frog tee, and the pictures are real ones.
  assert.match((await cards(page)).join(" || "), /frog tee: print differs/);
  assert.doesNotMatch(await text(page, "#progress"), /collage/);
});

test("a local download that fails, or an app that goes away, does not leave Setup waiting for ever", options, async (t) => {
  const services = { local: { catalog: localCatalog(), pullFails: true } };
  const { page } = await open(t, { services });
  await page.click('#providers input[value="local"]', { force: true });
  await page.selectOption("#local-tier", "small");
  await page.click("#local-connect");
  await untilText(page, "#local-status", "has to be downloaded first");

  await page.click("#local-download");
  await untilText(page, "#local-status", "Downloading");
  await untilText(page, "#local-status", "The download didn't finish (it said: disk full). Download");
  assert.equal(await page.locator("#local-status.error").count(), 1);
  assert.equal(await page.isVisible("#local-download"), true);
  assert.equal(await page.isEnabled("#local-model"), true);
  assert.equal(await page.isHidden("#local-progress"), true);

  // A second try: the download is stopped inside the app.
  services.local.pullFails = false;
  await page.click("#local-download");
  await untilText(page, "#local-status", "Downloading");
  services.local.job.status = "cancelled";
  await untilText(page, "#local-status", "was stopped in Lemonade");
  assert.equal(await page.isVisible("#local-download"), true);

  // A third: the app is restarted and no longer knows of the download.
  await page.click("#local-download");
  await untilText(page, "#local-status", "Downloading");
  services.local.job = null;
  await page.waitForFunction(() => document.querySelector("#local-status").textContent.includes("didn't finish"), null, { timeout: 30_000 });
  assert.equal(await page.isVisible("#local-download"), true);

  // A fourth: the download starts, then the app is closed.
  const app = services.local;
  await page.click("#local-download");
  await untilText(page, "#local-status", "Downloading");
  services.local = null;
  await page.waitForFunction(() => document.querySelector("#local-status").textContent.includes("Lost touch"), null, { timeout: 30_000 });
  assert.equal(await page.isEnabled("#local-model"), true);
  assert.equal(await page.isHidden("#local-progress"), true);

  // An app that won't take the download on says why.
  services.local = app;
  app.job = null; // opened again, it knows of no download
  await page.click("#local-connect");
  await untilText(page, "#local-status", "has to be downloaded first");
  app.refusePull = true;
  await page.click("#local-download");
  await untilText(page, "#local-status", "wouldn't start the download (it said: Server is offline)");
});

test("a download in the app is picked up again after the page was closed, and a paused one says so", options, async (t) => {
  // The standard model is already on this computer; the visitor asks for the larger one as well.
  const catalog = localCatalog().map((model) => ({ ...model, downloaded: model.id === "Flux-2-Klein-4B" }));
  const services = { local: { catalog, startsAt: 1_000_000_000, bytesPerRead: 25_000_000 } };
  const { page, seen } = await open(t, { services });
  await page.click('#providers input[value="local"]', { force: true });
  await page.selectOption("#local-tier", "small");
  await page.click("#local-connect");
  await untilText(page, "#local-status", "Connected and ready.");
  await page.selectOption("#local-model", "Flux-2-Klein-9B-GGUF");
  await untilText(page, "#local-status", "has to be downloaded first (19 GB)");
  await page.click("#local-download");
  await page.waitForFunction(() => document.querySelector("#local-progress-text").textContent.includes("Mbps"));

  // The page is closed and opened again; the app carried on meanwhile.
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);
  assert.equal(await page.isHidden("#local-progress"), true);
  services.local.startsAt = 9_500_000_000;
  services.local.bytesPerRead = 0;
  services.local.job.reads = 0;
  await page.click("#local-connect");
  await untilText(page, "#local-status", "Downloading 19 GB");
  await untilText(page, "#local-progress-text", "9.5 of 19.0 GB (50%)");
  assert.equal(await page.inputValue("#local-model"), "Flux-2-Klein-9B-GGUF");
  assert.equal(await page.isHidden("#local-download"), true);
  assert.equal(await page.isDisabled("#local-model"), true);
  assert.deepEqual(seen.local, [{ pull: "Flux-2-Klein-9B-GGUF" }], "picked up, not asked for a second time");

  // Paused inside the app: the page says where to resume it, and shows no speed.
  services.local.job.status = "paused";
  await untilText(page, "#local-status", "The download is paused. Resume it inside Lemonade");
  assert.equal(await text(page, "#local-progress-text"), "9.5 of 19.0 GB (50%)");
  assert.equal(await page.$eval("#local-progress-bar", (bar) => bar.value), 50);

  services.local.job.status = "downloading";
  await untilText(page, "#local-status", "Downloading 19 GB");
  finishDownload(services.local);
  await untilText(page, "#local-status", "Connected and ready.");
  // The model that was asked for is the one now in use, not the one that was there before.
  assert.equal(await page.inputValue("#local-model"), "Flux-2-Klein-9B-GGUF");
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("fitbash-settings"))).localModel, "Flux-2-Klein-9B-GGUF");
  assert.equal(await text(page, "#settings-summary"), "This computer connected");
  assert.deepEqual(seen.errors, []);
});

test("who wears the outfit, their build and the setting can be chosen where they apply, and are remembered", options, async (t) => {
  const { page, seen } = await open(t, { context: devices["Pixel 7"], services: {} });
  await page.fill("#provider-key", "GOOD-KEY");
  await addFiles(page, [TEE, JEANS]);
  const said = () => seen.google.at(-1).body.input[0].text;
  const make = async () => {
    await page.click("#generate");
    await untilText(page, "#progress", "Your outfit is ready.");
  };
  const pick = (name, value) => page.check(`input[name="${name}"][value="${value}"]`, { force: true });
  const shown = () => page.$$eval("#look-choices fieldset:not([hidden]) legend", (legends) => legends.map((legend) => legend.textContent));
  const anyOfIt = /woman|a man|build|plus-size|street|park/i;

  // A flat lay has nobody in it and no setting: nothing is asked.
  assert.deepEqual(await shown(), []);
  await pick("style", "mannequin");
  assert.deepEqual(await shown(), ["Worn by", "Build"]);
  assert.deepEqual(await page.$$eval("#wearer-choice label", (labels) => labels.map((label) => label.textContent)), ["Either", "A woman", "A man"]);
  assert.deepEqual(await page.$$eval("#build-choice label", (labels) => labels.map((label) => label.textContent)), ["Any", "Slim", "Average", "Plus-size"]);
  for (const name of ["wearer", "build", "place"]) assert.equal(await page.isChecked(`input[name="${name}"][value=""]`), true, name);

  // Left as they are, nothing is said and the picture model decides, as before.
  await make();
  assert.doesNotMatch(said(), anyOfIt);
  assert.match(said(), /against a plain light studio background\.\n/);

  await pick("wearer", "man");
  await pick("build", "slim");
  await make();
  assert.match(said(), /studio background\. The mannequin has a man's figure\. The mannequin has a slim build\.\n/);

  // A setting is offered for a person, not for a mannequin, and takes the plain backdrop's place.
  await pick("style", "model");
  assert.deepEqual(await shown(), ["Worn by", "Build", "Setting"]);
  assert.deepEqual(await page.$$eval("#place-choice label", (labels) => labels.map((label) => label.textContent)), ["Plain studio", "City street", "Outdoors"]);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    0,
    "the three choices fit a phone",
  );
  await pick("wearer", "woman");
  await pick("build", "plus");
  await pick("place", "street");
  await page.uncheck("#fill");
  await make();
  assert.match(said(), /head-to-toe photo, standing front on in a city street in daylight[^\n]*\. The model is a woman\. The model is plus-size\.\n/);
  assert.doesNotMatch(said(), /against a plain light background|studio photo/);

  // Back on a flat lay the choices are put away and not sent.
  await pick("style", "flatlay");
  assert.deepEqual(await shown(), []);
  await make();
  assert.doesNotMatch(said(), anyOfIt);

  // The next visit starts the way this one was left: the look, the choices and the basics tick,
  // whichever of them was touched last.
  const comeBack = async () => {
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);
  };
  await pick("style", "model");
  await pick("build", "average");
  await page.check("#fill");
  await comeBack();
  assert.equal(await page.isChecked('input[name="style"][value="model"]'), true);
  assert.deepEqual(await shown(), ["Worn by", "Build", "Setting"]);
  assert.equal(await page.isChecked('input[name="wearer"][value="woman"]'), true);
  assert.equal(await page.isChecked('input[name="build"][value="average"]'), true);
  assert.equal(await page.isChecked('input[name="place"][value="street"]'), true);
  assert.equal(await page.isChecked("#fill"), true);
  await page.uncheck("#fill");
  await pick("build", "slim");
  await comeBack();
  assert.equal(await page.isChecked("#fill"), false);
  assert.equal(await page.isChecked('input[name="build"][value="slim"]'), true);
  await pick("build", "average");

  // Using a past outfit again brings back its look and what was chosen for it.
  await page.locator('.past button:has-text("Use these pieces")').nth(2).click();
  await untilText(page, "#add-status", "Loaded the 2 pieces");
  assert.equal(await page.isChecked('input[name="style"][value="mannequin"]'), true);
  assert.deepEqual(await shown(), ["Worn by", "Build"]);
  assert.equal(await page.isChecked('input[name="wearer"][value="man"]'), true);
  assert.equal(await page.isChecked('input[name="build"][value="slim"]'), true);
  assert.deepEqual(seen.errors, []);
});

test("a piece without a name gets a quiet tip, which goes once every piece is named", options, async (t) => {
  const { page } = await open(t, { services: {} });
  assert.equal(await page.isHidden("#name-hint"), true);
  await addFiles(page, [TEE, JEANS]);
  assert.equal(await page.isVisible("#name-hint"), true);
  assert.match(await text(page, "#name-hint"), /type what each piece is.*helps keep an unusual piece right/s);
  await page.locator(".item input").nth(0).fill("frog tee");
  assert.equal(await page.isVisible("#name-hint"), true);
  await page.locator(".item input").nth(1).fill("blue jeans");
  assert.equal(await page.isHidden("#name-hint"), true);
  await page.locator(".item input").nth(1).fill("  ");
  assert.equal(await page.isVisible("#name-hint"), true);
  await page.locator(".item .remove").nth(1).click();
  assert.equal(await page.isHidden("#name-hint"), true);
  await page.locator(".item .remove").nth(0).click();
  assert.equal(await page.isHidden("#name-hint"), true);
});

test("a 12 to 16 GB card is offered the larger model, unless a model is already on the computer", options, async (t) => {
  const services = { local: { catalog: localCatalog() } };
  const { page } = await open(t, { services });
  await page.click('#providers input[value="local"]', { force: true });
  await page.selectOption("#local-tier", "medium");
  assert.match(await text(page, "#local-advice"), /^Enough for the larger model, which keeps prints and lettering better\. The standard model is a smaller download and quicker\. Close games/);

  // Nothing downloaded yet: the larger model is the one offered, and the standard one stays in the list.
  await page.click("#local-connect");
  await untilText(page, "#local-status", "has to be downloaded first (19 GB)");
  assert.equal(await page.inputValue("#local-model"), "Flux-2-Klein-9B-GGUF");
  assert.deepEqual(await page.$$eval("#local-model option", (nodes) => nodes.map((node) => node.value)), ["Flux-2-Klein-9B-GGUF", "Flux-2-Klein-4B"]);
  assert.match(await text(page, "#settings-summary"), /Do this once/);

  // The standard model is already there: it is used, and nobody is sent off to download 19 GB first.
  const reconnect = async () => {
    const listed = page.waitForResponse((response) => response.url().includes("/v1/models"));
    await page.click("#local-connect");
    await listed;
  };
  services.local.catalog = localCatalog().map((model) => ({ ...model, downloaded: model.id === "Flux-2-Klein-4B" }));
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);
  await reconnect();
  await untilText(page, "#local-status", "Connected and ready.");
  assert.equal(await page.inputValue("#local-model"), "Flux-2-Klein-4B");
  // Quality comes first, so the better model is pointed out while the page works with the one that is there.
  assert.equal(
    await text(page, "#local-status"),
    "Connected and ready. For prints and lettering kept better, choose Flux-2-Klein-9B-GGUF in the list (a 19 GB download).",
  );
  assert.equal(await text(page, "#settings-summary"), "This computer connected");
  // A card too small for it is told nothing of the kind.
  await page.selectOption("#local-tier", "small");
  await reconnect();
  await page.waitForFunction(() => document.querySelector("#local-status").textContent === "Connected and ready.");
  await page.selectOption("#local-tier", "medium");

  // Both there, and no choice made before: the one that suits the computer.
  services.local.catalog = localCatalog().map((model) => ({ ...model, downloaded: true }));
  await page.evaluate(() => localStorage.setItem("fitbash-settings", JSON.stringify({ ...JSON.parse(localStorage.getItem("fitbash-settings")), localModel: "" })));
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);
  await reconnect();
  await page.waitForFunction(() => document.querySelector("#local-status").textContent === "Connected and ready.");
  assert.equal(await page.inputValue("#local-model"), "Flux-2-Klein-9B-GGUF");
  // Choosing the standard one all the same is the visitor's call: nothing is left to download, so no tip.
  await page.selectOption("#local-model", "Flux-2-Klein-4B");
  await untilText(page, "#settings-summary", "This computer connected");
  assert.equal(await text(page, "#local-status"), "Connected and ready.");
});

test("the picture engine's one more step is shown for any graphics card, and goes away once it is done", options, async (t) => {
  const services = { local: { catalog: localCatalog().map((model) => ({ ...model, downloaded: true })) } };
  const { page } = await open(t, { context: devices["Pixel 7"], services });
  await page.click('#providers input[value="local"]', { force: true });
  await page.selectOption("#local-tier", "small");
  assert.match(await text(page, "#local-advice"), /close other programs that use the graphics card/);
  assert.equal(await page.isHidden("#local-memory"), true);

  await page.click("#local-connect");
  await untilText(page, "#local-status", "Connected and ready.");
  await page.waitForSelector("#local-memory:not([hidden])");
  assert.match(await text(page, "#local-memory-why"), /^One more step, done once\. Without it the app runs out of graphics memory as soon as an outfit has two pieces or more:$/);
  // The line that made pictures work on a real 12 GB card.
  assert.equal(
    await text(page, "#local-memory-command"),
    'lemonade load Flux-2-Klein-4B --sdcpp-args "--diffusion-fa --offload-to-cpu" --save-options',
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    0,
    "the long line fits a phone",
  );

  // Copy puts the line on the clipboard; where the browser won't allow that, it selects the line to copy by hand.
  await page.click("#local-memory-copy");
  await page.waitForFunction(
    () =>
      document.querySelector("#local-memory-copy").textContent === "Copied" ||
      getSelection().toString() === document.querySelector("#local-memory-command").textContent,
  );

  // Measured on the real app: without the step four pieces need 41 GB of card memory, more than
  // any card has. So it is shown whatever the visitor said their computer is.
  for (const tier of ["large", "small", "apple", "none"]) {
    await page.selectOption("#local-tier", tier);
    assert.equal(await page.isVisible("#local-memory"), true, tier);
  }

  // Saving the option that fixes nothing on its own does not put the step away.
  const save = (sdcpp_args) =>
    (services.local.catalog = services.local.catalog.map((model) =>
      model.id === "Flux-2-Klein-4B" ? { ...model, recipe_options: { steps: 4, sdcpp_args } } : model,
    ));
  save("--offload-to-cpu");
  const listed = page.waitForResponse((response) => response.url().includes("/v1/models"));
  await page.click("#local-connect");
  await listed;
  await untilText(page, "#local-status", "Connected and ready.");
  assert.equal(await page.isVisible("#local-memory"), true);

  // The step is done in a terminal; the app then lists the model with the options saved.
  services.local.catalog = services.local.catalog.map((model) =>
    model.id === "Flux-2-Klein-4B" ? { ...model, recipe_options: { steps: 4, sdcpp_args: "--diffusion-fa --offload-to-cpu" } } : model,
  );
  await page.click("#local-connect");
  await page.waitForSelector("#local-memory", { state: "hidden" });
  assert.equal(await text(page, "#local-status"), "Connected and ready.");

  // The standard model on a 12 to 16 GB card wants one option more, measured on a real 12 GB card. Someone
  // who did the step before that was known is shown it again, with its own reason and the whole line.
  await page.selectOption("#local-tier", "medium");
  await page.waitForSelector("#local-memory:not([hidden])");
  assert.equal(await page.inputValue("#local-model"), "Flux-2-Klein-4B");
  assert.equal(
    await text(page, "#local-memory-why"),
    "One more step for this graphics card, done once. Without it a one-piece outfit often fails while other programs are using the card:",
  );
  assert.equal(
    await text(page, "#local-memory-command"),
    'lemonade load Flux-2-Klein-4B --sdcpp-args "--diffusion-fa --offload-to-cpu --max-vram 8" --save-options',
  );
  // A larger or smaller card is not given an option nobody measured there.
  await page.selectOption("#local-tier", "large");
  assert.equal(await page.isHidden("#local-memory"), true);
  await page.selectOption("#local-tier", "medium");
  save("--diffusion-fa --offload-to-cpu --max-vram 8");
  await page.click("#local-connect");
  await page.waitForSelector("#local-memory", { state: "hidden" });
});

test("a local picture that fails says what to try, and points to the one more step while it is still to do", options, async (t) => {
  const services = { local: { catalog: localCatalog().map((model) => ({ ...model, downloaded: true })), engineError: "generate_image returned no results" } };
  const { page } = await open(t, { services });
  await page.click('#providers input[value="local"]', { force: true });
  await page.selectOption("#local-tier", "large");
  await page.click("#local-connect");
  await untilText(page, "#local-status", "Connected and ready.");
  await page.selectOption("#local-model", "Flux-2-Klein-4B");
  await untilText(page, "#settings-summary", "This computer connected");
  assert.equal(await page.isVisible("#local-memory"), true);

  // Setup is closed and the page reopened, as on a later visit: nothing has been asked of the app yet.
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);
  assert.equal(await page.evaluate(() => document.querySelector("#settings").open), false);
  await addFiles(page, [TEE, JEANS]);
  await page.click("#generate");
  await untilText(page, "#progress", "One more step in Setup usually fixes this");
  assert.match(await text(page, "#progress"), /^The app on your computer couldn't make that picture\. Most often the graphics card ran out of room: close games and other programs that use the card, then try again\. \(It said: generate_image returned no results\) One more step in Setup usually fixes this; it is shown there now\.$/);
  assert.equal(await page.evaluate(() => document.querySelector("#settings").open), true);
  assert.equal(await page.isVisible("#local-memory"), true);
  assert.match(await text(page, "#local-memory-why"), /^One more step, done once\./);

  // With the step done the page stops promising it, and the advice stands on its own.
  services.local.catalog = services.local.catalog.map((model) => ({ ...model, recipe_options: { steps: 4, sdcpp_args: "--diffusion-fa --offload-to-cpu" } }));
  await page.click("#local-connect");
  await page.waitForSelector("#local-memory", { state: "hidden" });
  await page.click("#generate");
  await untilText(page, "#progress", "(It said: generate_image returned no results)");
  await page.waitForFunction(() => !document.querySelector("#progress").textContent.includes("One more step"));
  assert.match(await text(page, "#progress"), /close games and other programs that use the card, then try again\. \(It said/);
  assert.match(await text(page, "#local-memory-command"), /^lemonade load Flux-2-Klein-4B /);

  // An app that isn't Lemonade's picture engine is given no line to paste, and no promise of one.
  services.local.catalog = [{ id: "sd-cpp-local" }];
  await page.click("#local-connect");
  await untilText(page, "#local-status", "Connected and ready.");
  await page.click("#generate");
  await untilText(page, "#progress", "(It said: generate_image returned no results)");
  await page.waitForFunction(() => !document.querySelector("#progress").textContent.includes("One more step"));
  assert.equal(await page.isHidden("#local-memory"), true);
});

test("a local model that combines four pieces says so, and is not sent a fifth", options, async (t) => {
  const services = { local: { catalog: localCatalog().map((model) => ({ ...model, downloaded: true })) } };
  const { page, seen } = await open(t, { services });
  await page.click('#providers input[value="local"]', { force: true });
  await page.selectOption("#local-tier", "small");
  await page.click("#local-connect");
  await untilText(page, "#local-status", "Connected and ready.");
  assert.match(await page.$eval("#local-model option:checked", (option) => option.textContent), /^Flux-2-Klein-4B · 16\.1 GB · up to 4 pieces$/);

  await addFiles(page, [TEE, JEANS, TEE, JEANS, TEE]);
  await page.click("#generate");
  await untilText(page, "#progress", "combines at most 4 pieces");
  assert.match(await text(page, "#progress"), /Remove one and try again, or choose a paid service in Setup/);
  assert.deepEqual(seen.local, [], "no picture was asked for");

  await page.click(".item:last-child .remove");
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  assert.deepEqual(seen.local, [{ model: "Flux-2-Klein-4B", size: "896x1152", pictures: 4 }]);
});

test("when the local app can't make the picture, the page gives its reason and something to try", options, async (t) => {
  // What a visitor with a 12 GB card got from the real app for three pieces was only "sd-server request failed".
  const services = { local: { catalog: localCatalog().map((model) => ({ ...model, downloaded: true })), engineError: "failed to allocate buffer of 9216 MiB" } };
  const { page } = await open(t, { services });
  await page.click('#providers input[value="local"]', { force: true });
  await page.click("#local-connect");
  await untilText(page, "#local-status", "Connected and ready.");
  await addFiles(page, [TEE, JEANS]);
  await page.click("#generate");
  await untilText(page, "#progress", "ran out of room");
  // The model is one the app's picture engine runs, so the page also points to the step that gives it room.
  assert.match(await text(page, "#progress"), /^Your graphics card ran out of room.*Close games and other programs.*\(It said: failed to allocate buffer of 9216 MiB\) One more step in Setup usually fixes this/);
  assert.equal(await page.locator("#progress.error").count(), 1);

  services.local.engineError = "unsupported sampler";
  await page.click("#generate");
  await untilText(page, "#progress", "(It said: unsupported sampler)");
  assert.match(await text(page, "#progress"), /^The app on your computer couldn't make that picture\. Most often the graphics card ran out of room/);
  assert.equal(await page.isEnabled("#generate"), true);
});

test("changing the local app's address makes Setup unfinished again", options, async (t) => {
  const services = { local: { catalog: localCatalog().map((model) => ({ ...model, downloaded: true })) } };
  const { page } = await open(t, { services });
  await page.click('#providers input[value="local"]', { force: true });
  await page.selectOption("#local-tier", "small");
  await page.click("#local-connect");
  await untilText(page, "#local-status", "Connected and ready.");
  assert.equal(await text(page, "#settings-summary"), "This computer connected");

  await page.click(".sub:last-of-type summary");
  await page.fill("#local-url", "http://127.0.0.1:1234/v1");
  assert.match(await text(page, "#settings-summary"), /Do this once/);
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("fitbash-settings")));
  assert.equal(stored.localModel, "");
});

test("OpenRouter with a pasted key: choose a model, make a picture, and hear plainly when something is in the way", options, async (t) => {
  const services = {};
  const { page, seen } = await open(t, { services });
  await page.click('#providers input[value="openrouter"]', { force: true });
  assert.equal(await page.isVisible("#provider-connect"), true);
  assert.equal(await page.getAttribute("#provider-key-link", "href"), "https://openrouter.ai/keys");
  assert.match(await text(page, "#provider-note"), /once you have added some credit/);

  await page.fill("#provider-key", "WRONG");
  await untilText(page, "#provider-key-status", "wasn't accepted");
  await page.fill("#provider-key", "GOOD-OR");
  await untilText(page, "#provider-key-status", "This key works");
  assert.equal(await text(page, "#settings-summary"), "OpenRouter connected");

  // The suggested model is chosen to begin with; another can be picked from the list.
  assert.equal(await page.inputValue("#provider-model-choice"), "google/gemini-nano-banana-2.1");
  assert.match(await page.textContent("#provider-model-choice option:checked"), /suggested/);
  await page.selectOption("#provider-model-choice", "openai/gpt-image-2.5-sunburst");

  await addFiles(page, [TEE, JEANS]);
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  const [call] = seen.openrouter;
  assert.equal(call.authorization, "Bearer GOOD-OR");
  const { input_references: references, prompt, ...rest } = call.body;
  assert.deepEqual(rest, { model: "openai/gpt-image-2.5-sunburst", aspect_ratio: "3:4", n: 1, response_format: "b64_json", quality: "medium" });
  assert.equal(references.length, 2);
  assert.match(references[0].image_url.url, /^data:image\/jpeg;base64,/);
  assert.match(prompt, /complete outfit/);
  await page.waitForSelector(".past");
  assert.equal(seen.google.length + seen.openai.length, 0);

  // A model that takes fewer pieces says so before any money is spent.
  await page.selectOption("#provider-model-choice", "microsoft/mai-image-2.7");
  assert.match(await page.textContent("#provider-model-choice option:checked"), /up to 5 pieces/);
  await addFiles(page, Array(4).fill(TEE));
  await page.click("#generate");
  await untilText(page, "#progress", "takes at most 5 pieces");
  assert.equal(seen.openrouter.length, 1);

  // An account with no credit is told so.
  await page.selectOption("#provider-model-choice", "google/gemini-nano-banana-2.1");
  services.openrouterError = [402, { error: { code: 402, message: "Insufficient credits", metadata: { limit_source: "openrouter_credits" } } }];
  await page.click("#generate");
  await untilText(page, "#progress", "needs credit");

  // The choice of model is remembered, and a name typed under Advanced shows in the list.
  await reloaded(page);
  assert.equal(await page.inputValue("#provider-model-choice"), "google/gemini-nano-banana-2.1");
  await page.click("#settings > summary");
  await page.click(".sub:last-of-type summary");
  await page.fill("#provider-model", "someone/another-model");
  assert.equal(await page.inputValue("#provider-model-choice"), "someone/another-model");

  // "Forget my keys" forgets this one too.
  await page.click("#forget");
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("fitbash-settings"))).openrouterKey, "");
  assert.match(await text(page, "#settings-summary"), /Do this once/);
  assert.deepEqual(seen.errors, []);
});

test("Connect OpenRouter: sign in there, come back with the key filled in", options, async (t) => {
  const services = {};
  const { page, seen } = await open(t, { services });
  await page.click('#providers input[value="openrouter"]', { force: true });

  await page.click("#provider-connect-button");
  await untilText(page, "#provider-key-status", "Connected to OpenRouter");
  // The visitor was sent to OpenRouter with this page as the way back, and nothing secret in the address.
  const [signIn] = seen.signIns;
  assert.equal(signIn.callback_url, `${staticSite.origin}/fitbash/`);
  assert.equal(signIn.code_challenge_method, "S256");
  assert.match(signIn.code_challenge, /^[A-Za-z0-9_-]{43}$/);
  // Back on the page: the key is in place, Setup is open on it, and the one-time code is gone from the address bar.
  assert.equal(await page.inputValue("#provider-key"), "GOOD-OR");
  assert.equal(await text(page, "#settings-summary"), "OpenRouter connected");
  assert.equal(await page.evaluate(() => document.querySelector("#settings").open), true);
  assert.equal(await page.evaluate(() => location.search), "");
  assert.equal(await page.evaluate(() => sessionStorage.length), 0);

  await addFiles(page, TEE);
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  assert.equal(seen.openrouter[0].authorization, "Bearer GOOD-OR");

  // A sign-in that OpenRouter does not honour leaves the old key alone and says what to do.
  services.signInFails = true;
  await page.click("#provider-connect-button");
  await untilText(page, "#provider-key-status", "didn't finish");
  assert.equal(await page.inputValue("#provider-key"), "GOOD-OR");
  assert.equal(await page.evaluate(() => location.search), "");
  assert.deepEqual(seen.errors, []);
});

test("an address that merely carries a code starts nothing", options, async (t) => {
  const { page, seen } = await open(t, { url: `${staticSite.origin}/fitbash/?code=STRAY` });
  assert.equal(await page.evaluate(() => location.search), "");
  assert.equal(await page.inputValue("#provider-key"), "");
  assert.equal(await page.evaluate(() => document.querySelector('#providers input:checked').value), "gemini");
  assert.equal(seen.signIns.length, 0);
});

// ---- ease of use: what a first-time visitor on a phone meets -----------------

test("a first visit shows an example outfit, and its three pieces can be tried with one press", options, async (t) => {
  const { page, seen } = await open(t);
  await page.waitForSelector("#example:not([hidden])");
  // The example's pictures really load, from the subfolder the site is served under.
  const loaded = await page.$$eval("#example img", (pictures) => pictures.map((picture) => picture.complete && picture.naturalWidth > 0));
  assert.deepEqual(loaded, [true, true, true, true]);

  await page.click("#example-try");
  await untilText(page, "#add-status", "Added the three example pieces");
  assert.deepEqual(
    await page.$$eval(".item input", (inputs) => inputs.map((input) => input.value)),
    ["frog tee", "blue jeans", "red and white sneakers"],
  );
  assert.equal(await text(page, "#count"), "3 of 8");
  // The same three are not added twice.
  assert.equal(await page.isDisabled("#example-try"), true);
  assert.equal(await page.isEnabled("#generate"), true);
  // With the pieces taken away again the offer is back, and it is withdrawn once a visitor adds a piece of their own.
  for (let n = 3; n > 0; n--) await page.click(".item .remove");
  assert.equal(await page.isEnabled("#example-try"), true);
  await addFiles(page, TEE);
  assert.equal(await page.isDisabled("#example-try"), true);

  // Someone who has already made an outfit here needs no introduction.
  await page.fill("#provider-key", "GOOD-KEY");
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  await page.waitForSelector(".past");
  await page.reload();
  await page.waitForSelector(".past");
  assert.equal(await page.isHidden("#example"), true);
  assert.deepEqual(seen.failed, ["/fitbash/api/config", "/fitbash/api/config"]);
  assert.deepEqual(seen.errors, []);
});

test("on a phone, making an outfit brings the outfit into view and counts the wait", options, async (t) => {
  const services = { googleDelay: 4000 };
  const { page } = await open(t, { context: { ...devices["Pixel 7"], reducedMotion: "no-preference" }, services });
  await page.fill("#provider-key", "GOOD-KEY");
  await addFiles(page, [TEE, JEANS]);
  const stageTop = () => page.evaluate(() => document.querySelector("#stage").getBoundingClientRect().top / window.innerHeight);
  // With the button in the middle of the screen, the outfit's frame begins in the lower half and runs off it.
  await page.locator("#generate").scrollIntoViewIfNeeded();
  assert.ok((await stageTop()) > 0.5, `the outfit frame should start low on the screen, at ${await stageTop()}`);
  assert.equal(await page.isHidden("#elapsed"), true);

  await page.click("#generate");
  await page.waitForFunction(() => {
    const top = document.querySelector("#stage").getBoundingClientRect().top;
    return top >= -1 && top < window.innerHeight * 0.3;
  });
  // The wait is counted where it can be seen.
  await page.waitForFunction(() => {
    const clock = document.querySelector("#elapsed");
    return !clock.hidden && clock.getClientRects().length > 0 && /^0:0[1-9]$/.test(clock.textContent);
  });
  await untilText(page, "#progress", "Your outfit is ready.");
  await page.waitForFunction(() => document.querySelector("#elapsed").hidden);

  // "Make another" at the foot of the outfit goes back to the top of it, where the progress is.
  await page.locator("#again").scrollIntoViewIfNeeded();
  await page.click("#again");
  await page.waitForFunction(() => {
    const top = document.querySelector("#stage").getBoundingClientRect().top;
    return top >= -1 && top < window.innerHeight * 0.3;
  });
  await untilText(page, "#progress", "Your outfit is ready.");
});

test("on a phone, every row of choices fits on one line and the small buttons are big enough to tap", options, async (t) => {
  const { page } = await open(t, { context: devices["Pixel 7"] });
  await addFiles(page, TEE);
  await page.check('input[name="style"][value="model"]', { force: true });
  // Each row's options sit side by side: none dropped to a line of its own.
  const rows = await page.$$eval("#styles, #look-choices fieldset:not([hidden]) .segments", (groups) =>
    groups.map((group) => new Set([...group.querySelectorAll("label")].map((label) => Math.round(label.getBoundingClientRect().top))).size),
  );
  assert.deepEqual(rows, [1, 1, 1, 1]);
  // Nothing is squeezed until its words are cut off.
  const cut = await page.$$eval("#styles span, #look-choices fieldset:not([hidden]) span", (spans) =>
    spans.filter((span) => span.scrollWidth > span.clientWidth).map((span) => span.textContent),
  );
  assert.deepEqual(cut, []);
  // The whole of the box's hint can be read: its words, in the box's own lettering, are no wider than the box.
  const hint = await page.$eval(".item input", (input) => {
    const style = getComputedStyle(input);
    const pen = document.createElement("canvas").getContext("2d");
    pen.font = `${style.fontSize} ${style.fontFamily}`;
    const room = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return { words: pen.measureText(input.placeholder).width, room };
  });
  assert.ok(hint.words <= hint.room, `the hint is ${hint.words}px wide in a box with room for ${hint.room}px`);

  const remove = await page.$eval(".item .remove", (button) => {
    const box = button.getBoundingClientRect();
    return Math.min(box.width, box.height);
  });
  assert.ok(remove >= 36, `the remove button is ${remove}px`);
});

test("a finished outfit can be saved, shared where the device allows it, and made again", options, async (t) => {
  // A device with a share sheet: this stand-in notes what it was handed.
  const init = () => {
    window.shared = [];
    navigator.canShare = (data) => Boolean(data?.files?.length) && data.files.every((file) => file.type === "image/png");
    navigator.share = async (data) => void window.shared.push({ title: data.title, name: data.files[0].name, type: data.files[0].type, size: data.files[0].size });
  };
  const { page, seen } = await open(t, { init });
  await addFiles(page, [TEE, JEANS]);

  // The stand-in collage is not worth sharing or making again: the page asks for Setup to be finished.
  await page.click("#generate");
  await untilText(page, "#progress", "only a collage");
  assert.equal(await page.isHidden("#after"), true);
  assert.equal(await page.locator(".attempt .share").count(), 0);

  await page.fill("#provider-key", "GOOD-KEY");
  await page.locator(".item input").nth(0).fill("frog tee");
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  // One picture carries no "first try" label; it says what it is of instead.
  assert.deepEqual(await cards(page), ["Save picture | Share"]);
  assert.equal(await text(page, ".attempt figcaption"), "Flat lay · frog tee and 1 more");
  assert.match(await page.getAttribute(".attempt .download", "href"), /^data:image\/png;base64,/);
  assert.equal(await page.getAttribute(".attempt .download", "download"), "fitbash-outfit-1.png");

  await page.click(".attempt .share");
  const shared = await page.evaluate(() => window.shared);
  assert.equal(shared.length, 1);
  assert.deepEqual([shared[0].name, shared[0].type], ["fitbash-outfit-1.png", "image/png"]);
  assert.equal(shared[0].size, Buffer.from(OUTFIT_RIGHT, "base64").length);

  await page.click("#again");
  await page.waitForFunction(() => document.querySelectorAll(".past").length === 2);
  assert.equal(seen.google.length, 2);
  assert.equal(await page.isVisible("#after"), true);
  assert.deepEqual(seen.errors, []);
});

test("a browser without a share sheet offers saving only", options, async (t) => {
  const { page } = await open(t, { init: () => delete Navigator.prototype.canShare });
  await page.fill("#provider-key", "GOOD-KEY");
  await addFiles(page, TEE);
  await page.click("#generate");
  await untilText(page, "#progress", "Your outfit is ready.");
  assert.deepEqual(await cards(page), ["Save picture"]);
});

test("with a model on this computer, the page says where it needs help: names, a note for odd shapes, and not a flat lay", options, async (t) => {
  const { page } = await open(t, { services: {} });
  await addFiles(page, TEE);
  // A paid service: the gentle tip about names, and nothing more.
  assert.match(await text(page, "#name-hint"), /^Tip: type what each piece is/);
  assert.equal(await page.isHidden("#notes-tip"), true);
  assert.equal(await page.isHidden("#look-tip"), true);

  await page.click('#providers input[value="local"]', { force: true });
  assert.match(await text(page, "#name-hint"), /what is unusual about it.*a piece with no name is often swapped for a plain one/s);
  assert.equal(await page.isVisible("#notes-tip"), true);
  assert.match(await text(page, "#notes-tip"), /describe anything unusual here/);
  // The flat lay is the look a local model does worst, so it is said while that look is chosen.
  assert.equal(await page.isVisible("#look-tip"), true);
  assert.match(await text(page, "#look-tip"), /“On a model” keeps your pieces best/);
  await page.check('input[name="style"][value="model"]', { force: true });
  assert.equal(await page.isHidden("#look-tip"), true);
  assert.equal(await page.isVisible("#notes-tip"), true);
  await page.check('input[name="style"][value="flatlay"]', { force: true });
  assert.equal(await page.isVisible("#look-tip"), true);

  // A named piece needs no tip about names, on either.
  await page.locator(".item input").fill("frog tee");
  assert.equal(await page.isHidden("#name-hint"), true);

  await page.click('#providers input[value="gemini"]', { force: true });
  assert.equal(await page.isHidden("#notes-tip"), true);
  assert.equal(await page.isHidden("#look-tip"), true);
});
