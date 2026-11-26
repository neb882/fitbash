// A visitor with the page open is told when a newer version of the site is out.
//
// Two stamped copies of the site are made the way the deploy makes them
// (scripts/stamp-version.sh), and the test server is switched from one to the
// other, as GitHub Pages is by a deploy.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { createApp } from "../../server.js";

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

function stampedCopy(edit) {
  const dir = mkdtempSync(path.join(tmpdir(), "fitbash-site-"));
  cpSync(path.join(root, "public"), dir, { recursive: true });
  edit?.(dir);
  const version = execFileSync("sh", [path.join(root, "scripts", "stamp-version.sh"), dir], { encoding: "utf8" }).trim();
  return { dir, version, app: createApp({ publicDir: dir }) };
}

let browser;
let server;
let origin;
let live; // the copy the server hands out now
let first;
let second;

before(async () => {
  first = stampedCopy();
  second = stampedCopy((dir) => {
    const page = path.join(dir, "index.html");
    writeFileSync(page, readFileSync(page, "utf8").replace("See them together as one outfit.", "The second version."));
  });
  assert.notEqual(first.version, second.version);

  server = http.createServer((req, res) => {
    if (!req.url.startsWith("/fitbash/") || req.url.startsWith("/fitbash/api/")) return res.writeHead(404).end();
    req.url = req.url.slice("/fitbash".length);
    live.app(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
});

after(async () => {
  await browser?.close();
  server?.close();
  for (const copy of [first, second]) if (copy) rmSync(copy.dir, { recursive: true, force: true });
});

async function visit(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(`${origin}/fitbash/`);
  await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);
  return page;
}

const pageVersion = (page) => page.getAttribute('meta[name="fitbash-version"]', "content");
// The version of the service worker now in charge of the page.
const versionInCharge = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const worker = navigator.serviceWorker.controller;
        if (!worker) return resolve("");
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => resolve(event.data.version);
        // A worker asked at the instant it is being replaced never answers. Without this the
        // question hung until the whole test timed out: seen on CI, on a commit whose other run passed.
        setTimeout(() => resolve(""), 1000);
        worker.postMessage({ type: "version" }, [channel.port2]);
      }),
  );
const untilInCharge = async (page, version) => {
  await assert.doesNotReject(
    (async () => {
      for (let i = 0; i < 100; i++) {
        if ((await versionInCharge(page)) === version) return;
        await page.waitForTimeout(100);
      }
      throw new Error(`version ${version} never took charge`);
    })(),
  );
};

const options = { timeout: 90_000 };

test("an open page is told when a newer version is out, and reloading brings it", options, async (t) => {
  live = first;
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await visit(context);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // A first visit: the worker takes charge, and there is nothing newer to announce.
  await untilInCharge(page, first.version);
  assert.equal(await pageVersion(page), first.version);
  assert.equal(await page.isHidden("#update-notice"), true);

  // The visitor has work on the page when the site is updated.
  await page.setInputFiles("#files", {
    name: "tee.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"),
  });
  await page.waitForSelector(".item");
  live = second;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());

  await page.waitForSelector("#update-notice:not([hidden])");
  assert.match(await page.textContent("#update-notice"), /A newer version of fitbash is out\./);
  // The page did not reload by itself: the piece is still there, and so is the old page.
  assert.equal(await page.locator(".item").count(), 1);
  assert.equal(await pageVersion(page), first.version);

  // "Later" puts the notice away without reloading.
  await page.click("#update-later");
  assert.equal(await page.isHidden("#update-notice"), true);
  assert.equal(await page.locator(".item").count(), 1);
  assert.deepEqual(errors, []);
});

test("pressing Reload on the notice loads the new version whole", options, async (t) => {
  live = first;
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await visit(context);
  await untilInCharge(page, first.version);
  live = second;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForSelector("#update-notice:not([hidden])");

  await Promise.all([page.waitForEvent("load"), page.click("#update-reload")]);
  await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);
  assert.equal(await pageVersion(page), second.version);
  assert.match(await page.textContent(".masthead"), /The second version\./);
  await untilInCharge(page, second.version);
  assert.equal(await page.isHidden("#update-notice"), true);
});

test("a visitor who comes back after an update gets the new version at once, with no notice", options, async (t) => {
  live = first;
  const context = await browser.newContext();
  t.after(() => context.close());
  const earlier = await visit(context);
  await untilInCharge(earlier, first.version);
  // A second load, under the worker's control, so that the worker holds its own copy of the old page.
  await earlier.reload();
  await earlier.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);
  // The visitor comes back later, not the same second. About a second after a page loads the browser looks
  // for a newer worker, once; a return visit that lands while that look is under way gets no look of its own,
  // so the look finds the old version and the new worker never takes over. Seen on CI and reproduced here:
  // with the two visits back to back this test failed now and then (once on CI, once in three runs here).
  await earlier.waitForTimeout(2500);
  await earlier.close();

  live = second;
  const page = await visit(context);
  // The old worker fetched the page fresh from the network instead of serving its own copy.
  assert.equal(await pageVersion(page), second.version);
  assert.match(await page.textContent(".masthead"), /The second version\./);
  // The new worker then takes over a page that is already the new version: nothing to announce.
  await untilInCharge(page, second.version);
  await page.waitForTimeout(300);
  assert.equal(await page.isHidden("#update-notice"), true);
});

test("the page still opens when the network is gone, from the copy the worker kept", options, async (t) => {
  live = first;
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await visit(context);
  await untilInCharge(page, first.version);
  await page.reload(); // a load under the worker's control, which is when it keeps its copies
  await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);
  assert.equal(await pageVersion(page), first.version);
  assert.equal(await page.locator("#styles input").count(), 3);
});
