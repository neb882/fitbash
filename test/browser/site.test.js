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
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, ...context });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15_000); // A page that never comes up should fail a test quickly, not hang it.
  const seen = { errors: [], failed: [], google: [], openai: [], claude: [], local: [] };
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

  await page.route("https://generativelanguage.googleapis.com/**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return preflight(route);
    const key = request.headers()["x-goog-api-key"];
    if (request.method() === "GET") {
      return key === "GOOD-KEY"
        ? json(route, 200, { models: [] })
        : json(route, 400, { error: { message: "API key not valid. Please pass a valid API key." } });
    }
    seen.google.push({ key, body: request.postDataJSON() });
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
  await page.route("http://localhost:13305/**", (route) => {
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
      const { model_name: name } = request.postDataJSON();
      seen.local.push({ pull: name });
      local.catalog = local.catalog.map((model) => (model.id === name ? { ...model, downloaded: true } : model));
      return json(route, 200, { status: "success" });
    }
    if (path === "/v1/images/edits") {
      const raw = request.postDataBuffer().toString("latin1");
      const field = (name) => new RegExp(`name="${name}"\r\n\r\n([^\r]+)`).exec(raw)?.[1];
      seen.local.push({ model: field("model"), size: field("size"), pictures: raw.match(/name="image\[\]"/g)?.length ?? 0 });
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
  { id: "Flux-2-Klein-9B-GGUF", size: 19, downloaded: false, labels: ["image", "edit"] },
  { id: "Flux-2-Klein-4B", size: 16.1, downloaded: false, labels: ["image", "edit"] },
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
  await untilText(page, "#progress", "Done.");

  assert.deepEqual(await cards(page), [
    "Attempt 2 | Matches your pieces · 9/10 | Best match | Download",
    "Attempt 1 | Off in places · 4/10 | frog tee: the print is red, not yellow | Download",
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
  await untilText(page, "#progress", "Done.");
  assert.deepEqual(await cards(page), ["Attempt 1 | Download"]);
  assert.equal(seen.google.length, 1);
  assert.equal(seen.google[0].body.input.filter((part) => part.type === "image").length, 2);
  assert.equal(seen.claude.length, 0);
});

test("a service's refusal is explained with what to do next", options, async (t) => {
  const billing = [429, { error: { message: "Quota exceeded for metric generate_content_free_tier_requests, limit: 0" } }];
  const { page } = await open(t, { services: { googleError: billing } });
  await page.fill("#provider-key", "GOOD-KEY");
  await addFiles(page, TEE);
  await page.click("#generate");
  await untilText(page, "#progress", "until billing is turned on");
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
  await untilText(page, "#progress", "Done.");
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
  await untilText(page, "#progress", "Done.");
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

  await page.selectOption("#local-tier", "medium");
  assert.match(await text(page, "#local-advice"), /good fit for the standard model/);

  await page.click("#local-connect");
  await untilText(page, "#local-status", "has to be downloaded first (16.1 GB)");
  // Only the models that can combine pictures are offered, the one that fits this computer first.
  assert.deepEqual(
    await page.$$eval("#local-model option", (nodes) => nodes.map((node) => node.value)),
    ["Flux-2-Klein-9B-GGUF", "Flux-2-Klein-4B"],
  );
  assert.equal(await page.inputValue("#local-model"), "Flux-2-Klein-4B");
  assert.match(await text(page, "#settings-summary"), /Do this once/);

  await page.click("#local-download");
  await untilText(page, "#local-status", "Connected and ready.");
  assert.deepEqual(seen.local, [{ pull: "Flux-2-Klein-4B" }]);
  assert.equal(await page.isHidden("#local-download"), true);
  assert.equal(await text(page, "#settings-summary"), "This computer connected");

  await addFiles(page, [TEE, JEANS]);
  await page.click("#generate");
  await untilText(page, "#progress", "Done.");
  assert.deepEqual(seen.local[1], { model: "Flux-2-Klein-4B", size: "1024x1024", pictures: 2 });
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
  await untilText(page, "#progress", "Done.");
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
  await untilText(page, "#progress", "Done.");
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
  await untilText(page, "#progress", "Done.");
  assert.equal(seen.google.length, sentBefore + 1);
  const again = seen.google.at(-1).body;
  assert.equal(again.input.filter((part) => part.type === "image").length, 2);
  assert.deepEqual(again.input[1], seen.google[0].body.input[1]); // the very same picture, not a re-compressed copy
  assert.equal(seen.claude.at(-1).body.messages[0].content.filter((block) => block.type === "image").length, 3);
  await page.waitForFunction(() => document.querySelectorAll(".past").length === 3);

  await page.click(".past:first-child .past-actions button:last-child");
  await page.waitForFunction(() => document.querySelectorAll(".past").length === 2);

  // Removing everything takes a second press.
  await page.click("#history-clear");
  assert.equal(await text(page, "#history-clear"), "Really remove all?");
  assert.equal(await page.locator(".past").count(), 2);
  await page.click("#history-clear");
  await page.waitForSelector("#history", { state: "hidden" });
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
  await untilText(page, "#progress", "Done.");
  assert.equal(await page.locator(".attempt img").count(), 1);
  assert.equal(await page.isHidden("#history"), true);
  assert.deepEqual(seen.errors, []);
});

// An automated accessibility check (contrast, names, roles, labels) of the page's main states.
// It finds what a machine can find; it does not replace trying the page with a keyboard.
for (const scheme of ["light", "dark"]) {
  test(`the page passes automated accessibility checks in the ${scheme} colours`, options, async (t) => {
    const services = { pictures: [OUTFIT_WRONG, OUTFIT_RIGHT], verdicts: [FAIL, PASS], local: { catalog: localCatalog() } };
    const { page } = await open(t, { context: { colorScheme: scheme }, services });
    const problems = async (state) => {
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      return violations.map((v) => `${state}: ${v.id} (${v.nodes.length}) ${v.nodes[0].target.join(" ")} — ${v.nodes[0].failureSummary.split("\n")[1]?.trim()}`);
    };
    const found = [];

    found.push(...(await problems("first visit, setup open")));

    await page.click('#providers input[value="local"]', { force: true });
    await page.click("#local-connect");
    await page.waitForSelector("#local-models:not([hidden])");
    found.push(...(await problems("local model steps")));

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
    await untilText(page, "#progress", "Done.");
    await page.waitForSelector(".past");
    found.push(...(await problems("results and past outfits")));

    await page.click(".past-picture");
    found.push(...(await problems("a past outfit opened larger")));

    assert.deepEqual(found, []);
  });
}
