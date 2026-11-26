// A run against the real image services, done the way a visitor does it: open
// the page in a browser, connect a key in Setup, add pictures of clothes, pick a
// look, press "Make the outfit". Every picture that comes back is saved, with
// what the service answered, so the result can be looked at and judged.
//
//   node test/real/run.mjs --pieces <folder> [options]
//
// This spends real money on the key's account. test/real/README.md says how to
// run it, where the key comes from, and what to look for afterwards.

import http from "node:http";
import path from "node:path";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

import { createApp } from "../../server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PICTURE = /\.(jpe?g|png|webp|avif|gif)$/i;
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", gif: "image/gif" };
const SERVICE_HOSTS = ["generativelanguage.googleapis.com", "api.openai.com", "openrouter.ai", "api.anthropic.com", "localhost:13305"];

const { values: options } = parseArgs({
  options: {
    pieces: { type: "string" },
    service: { type: "string", default: "gemini" }, // gemini | openai | openrouter | local
    model: { type: "string" }, // a model name, as typed under Advanced in Setup
    "key-env": { type: "string", default: "FITBASH_TEST_KEY" },
    "check-key-env": { type: "string", default: "" }, // the check is off unless a variable is named (usually FITBASH_TEST_CLAUDE_KEY): each check is the owner's money
    looks: { type: "string", default: "flatlay,model" },
    computer: { type: "string", default: "" }, // small | medium | large | apple | none: the answer to "What kind of computer is this?" (a test browser has no graphics card to recognise)
    wearer: { type: "string", default: "" }, // woman | man, for the mannequin and on-a-model looks
    build: { type: "string", default: "" }, // slim | average | plus, for the same two looks
    place: { type: "string", default: "" }, // street | outdoors, for the on-a-model look
    notes: { type: "string", default: "" },
    "no-basics": { type: "boolean", default: false }, // untick "Add plain basics for anything missing"
    site: { type: "string" }, // default: this checkout, served locally
    out: { type: "string", default: path.join(here, "out") },
    "max-pictures": { type: "string", default: "8" },
    "wait-minutes": { type: "string", default: "6" },
  },
});

if (!options.pieces) {
  console.error("Say where the pictures of the pieces are: --pieces <folder>. See test/real/README.md.");
  process.exit(2);
}

/** One outfit per subfolder; a folder holding pictures directly is a single outfit. */
function readOutfits(folder) {
  const picturesIn = (dir) =>
    readdirSync(dir)
      .filter((name) => PICTURE.test(name))
      .sort()
      .map((name) => ({
        name,
        mimeType: MIME[name.split(".").pop().toLowerCase()],
        buffer: readFileSync(path.join(dir, name)),
        // "01-frog-tee.jpg" is the piece a visitor would name "frog tee".
        label: name.replace(PICTURE, "").replace(/^\d+[-_ ]*/, "").replace(/[-_]+/g, " ").trim(),
      }));
  const direct = picturesIn(folder);
  if (direct.length) return [{ name: path.basename(path.resolve(folder)), pieces: direct }];
  return readdirSync(folder)
    .filter((name) => statSync(path.join(folder, name)).isDirectory())
    .sort()
    .map((name) => ({ name, pieces: picturesIn(path.join(folder, name)) }))
    .filter((outfit) => outfit.pieces.length);
}

const outfits = readOutfits(options.pieces);
if (outfits.length === 0) {
  console.error(`No pictures found in ${options.pieces}.`);
  process.exit(2);
}
const looks = options.looks.split(",").map((look) => look.trim()).filter(Boolean);
const maxPictures = Number(options["max-pictures"]);
const waitMs = Number(options["wait-minutes"]) * 60_000;
mkdirSync(options.out, { recursive: true });

// The key is typed into Setup as a visitor would type it. Where the workspace's
// network attaches the real key on the way out, any placeholder will do here.
const key = process.env[options["key-env"]] || "attached-by-the-environment";
const keyFromEnvironment = !process.env[options["key-env"]];
const checkKey = process.env[options["check-key-env"]] || "";

let server;
let site = options.site;
if (!site) {
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  site = `http://127.0.0.1:${server.address().port}/`;
}

/** A copy of a service's answer that is safe and small to keep: long strings (pictures, keys) cut short. */
const shorten = (value) =>
  typeof value === "string"
    ? value.length > 120
      ? `${value.slice(0, 60)}… (${value.length} characters)`
      : value
    : Array.isArray(value)
      ? value.map(shorten)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shorten(v)]))
        : value;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
// A browser asks before a website may reach an app on the computer, and with no window there is
// nobody to answer: allow it for the published site, as a visitor does by choosing Allow.
if (options.site) await context.grantPermissions(["local-network-access"], { origin: new URL(options.site).origin }).catch(() => {});
const page = await context.newPage();
const answers = []; // what the services answered during the current outfit
const failures = [];
page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));
page.on("requestfailed", (request) => {
  if (SERVICE_HOSTS.some((host) => request.url().includes(host))) {
    failures.push(`${request.method()} ${new URL(request.url()).host}: ${request.failure()?.errorText}`);
  }
});
page.on("response", async (response) => {
  const url = new URL(response.url());
  if (!SERVICE_HOSTS.includes(url.host) || response.request().method() === "OPTIONS") return;
  let body;
  try {
    body = shorten(await response.json());
  } catch {
    body = "(not JSON)";
  }
  answers.push({ request: `${response.request().method()} ${url.host}${url.pathname}`, status: response.status(), body });
});

const results = [];
let pictures = 0;
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

try {
  await page.goto(site);
  await page.waitForFunction(() => document.querySelector("#empty").textContent.length > 0);

  // ---- Setup, as a first-time visitor does it ----
  await page.click(`#providers input[value="${options.service}"]`, { force: true });
  let setup;
  if (options.service === "local") {
    if (options.computer) await page.selectOption("#local-tier", options.computer);
    await page.click("#local-connect");
    await page.waitForFunction(
      () => {
        const status = document.querySelector("#local-status").textContent;
        return (status.length > 0 && !status.startsWith("Looking")) || !document.querySelector("#local-allow").hidden;
      },
      null,
      { timeout: 30_000 },
    );
    setup = (await page.textContent("#local-status")) || "The app refused this page (see the steps Setup shows).";
  } else {
    await page.fill("#provider-key", key);
    await page.waitForFunction(() => /works|accepted|check the key/i.test(document.querySelector("#provider-key-status").textContent), null, { timeout: 40_000 }).catch(() => {});
    setup = await page.textContent("#provider-key-status");
  }
  if (options.model && options.service === "local") {
    // On this computer the model is picked from the list Setup shows; the box under Advanced is hidden.
    await page.selectOption("#local-model", options.model);
    await page.waitForTimeout(500);
    setup = await page.textContent("#local-status");
  } else if (options.model) {
    for (const summary of await page.locator(".sub summary").all()) if (/Advanced/.test(await summary.textContent())) await summary.click();
    await page.fill("#provider-model", options.model);
  }
  if (checkKey) {
    await page.click(".sub summary");
    await page.fill("#claude-key", checkKey);
    await page.waitForFunction(() => document.querySelector("#claude-key-status").textContent.length > 12, null, { timeout: 40_000 }).catch(() => {});
  }
  const summary = await page.textContent("#settings-summary");
  console.log(`Setup: ${setup.trim()} (${summary.trim()})`);

  // ---- each outfit, in each look ----
  run: for (const outfit of outfits) {
    for (const look of looks) {
      if (pictures >= maxPictures) {
        console.log(`Stopping: ${pictures} pictures made, and the limit is ${maxPictures}.`);
        break run;
      }
      answers.length = 0;
      failures.length = 0;
      while ((await page.locator(".item .remove").count()) > 0) await page.locator(".item .remove").first().click();
      await page.setInputFiles("#files", outfit.pieces.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer })));
      await page.waitForFunction((n) => document.querySelectorAll(".item").length === n, outfit.pieces.length);
      for (const [index, piece] of outfit.pieces.entries()) await page.locator(".item input").nth(index).fill(piece.label);
      await page.check(`input[name="style"][value="${look}"]`, { force: true });
      // Each choice is offered only for the looks it applies to; a hidden one is left alone.
      for (const name of ["wearer", "build", "place"]) {
        const choice = page.locator(`#${name}-choice:not([hidden]) input[value="${options[name]}"]`);
        if (options[name] && (await choice.count())) await choice.check({ force: true });
      }
      await page.fill("#notes", options.notes);
      await page.setChecked("#fill", !options["no-basics"]);

      const started = Date.now();
      await page.click("#generate");
      // Finished when the button can be pressed again: a picture, or a message saying why not.
      await page.waitForFunction(() => document.querySelector("#generate").textContent.includes("Make the outfit"), null, { timeout: waitMs }).catch(() => {});
      const seconds = Math.round((Date.now() - started) / 1000);
      const message = (await page.textContent("#progress")).trim();
      const failed = (await page.locator("#progress.error").count()) > 0;

      const name = `${slug(outfit.name)}-${look}`;
      const attempts = await page.$$eval(".attempt", (nodes) =>
        nodes.map((node) => ({
          attempt: Number(node.dataset.attempt),
          src: node.querySelector("img")?.src ?? "",
          notes: node.querySelector(".notes").innerText.replace(/\s*\n\s*/g, " | "),
        })),
      );
      const files = [];
      for (const attempt of attempts) {
        const match = /^data:image\/([a-z+]+);base64,(.+)$/.exec(attempt.src);
        if (!match) continue;
        const real = match[1] !== "svg+xml"; // the collage shown before Setup is finished is not a picture from a service
        const file = `${name}-attempt${attempt.attempt}.${match[1].replace("jpeg", "jpg").replace("svg+xml", "svg")}`;
        writeFileSync(path.join(options.out, file), Buffer.from(match[2], "base64"));
        files.push({ file, real, notes: attempt.notes });
        if (real) pictures++;
      }
      writeFileSync(path.join(options.out, `${name}-answers.json`), JSON.stringify({ answers, failures }, null, 2));
      results.push({ outfit: outfit.name, pieces: outfit.pieces.map((piece) => piece.label), look, seconds, failed, message, files, failures: [...failures] });
      console.log(`${failed ? "FAILED" : "ok    "} ${name} (${seconds} s): ${message}`);
      for (const failure of failures) console.log(`       ${failure}`);
    }
  }
} finally {
  await browser.close();
  server?.close();
}

// ---- a report to read the pictures against ----
const lines = [
  "# fitbash: a run against the real services",
  "",
  `- Service: ${options.service}${options.model ? `, model ${options.model}` : ""}`,
  `- Key: ${keyFromEnvironment ? "attached by the workspace's network (a placeholder was typed into Setup)" : `from ${options["key-env"]}`}`,
  `- Quality check: ${checkKey ? "on" : "off"}`,
  `- Site: ${options.site ?? "this checkout, served locally"}`,
  `- Pictures made by a service: ${pictures}`,
  "",
];
for (const result of results) {
  lines.push(`## ${result.outfit}, ${result.look}`, "", `Pieces: ${result.pieces.join(", ")}`, "", `${result.failed ? "**Failed**" : "Finished"} in ${result.seconds} s. The page said: “${result.message}”`, "");
  for (const file of result.files) lines.push(`- \`${file.file}\`${file.real ? "" : " (the stand-in collage, not a service's picture)"}: ${file.notes}`);
  for (const failure of result.failures) lines.push(`- ${failure}`);
  lines.push(`- What the services answered: \`${slug(result.outfit)}-${result.look}-answers.json\``, "");
}
writeFileSync(path.join(options.out, "report.md"), lines.join("\n"));
console.log(`\n${results.length} run(s), ${pictures} picture(s) from a service. Report and pictures: ${options.out}`);
process.exitCode = results.some((result) => result.failed) || pictures === 0 ? 1 : 0;
