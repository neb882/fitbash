import test from "node:test";
import assert from "node:assert/strict";

import {
  LOCAL_DEFAULT_URL,
  LOCAL_TIERS,
  createLocalProvider,
  findLocalModels,
  pickLocalModel,
  startLocalDownload,
} from "../public/lib/providers/local.js";
import { createProvider, PROVIDERS, ProviderError } from "../public/lib/providers/index.js";
import { TIERS } from "../public/lib/hardware.js";

const images = [
  { mimeType: "image/jpeg", data: Buffer.from("one").toString("base64") },
  { mimeType: "image/jpeg", data: Buffer.from("two").toString("base64") },
];
const PNG = "iVBORw0KGgoAAAANSUhEUg";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function recorder(respond) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  };
  return { fetchImpl, calls };
}

// The model list as Lemonade documents it (2026-11), trimmed to the fields that matter.
const CATALOG = {
  object: "list",
  data: [
    { id: "Gemma-4-E2B-it-GGUF", size: 3.1, downloaded: true, labels: ["reasoning"] },
    { id: "SD-Turbo", size: 5.21, downloaded: true, labels: ["image"] },
    { id: "RealESRGAN-x4plus", size: 0.1, downloaded: true, labels: ["image", "edit", "upscaling"] },
    { id: "Flux-2-Klein-9B-GGUF", size: 19.0, downloaded: false, labels: ["image", "edit"] },
    { id: "Flux-2-Klein-4B", size: 16.1, downloaded: false, labels: ["image", "edit"] },
  ],
};

test("the pieces go to the local app as a multipart edit, with no key", async () => {
  const { fetchImpl, calls } = recorder(() => json(200, { created: 1, data: [{ b64_json: PNG }], output_format: "png" }));
  const provider = createLocalProvider({ baseUrl: "http://localhost:13305/v1/", model: "Flux-2-Klein-4B", fetchImpl });
  const out = await provider.generate({ prompt: "an outfit", images, aspectRatio: "3:4" });

  assert.deepEqual(out, { mimeType: "image/png", data: PNG });
  const { url, init } = calls[0];
  assert.equal(url, "http://localhost:13305/v1/images/edits");
  assert.equal(init.headers, undefined);
  const form = init.body;
  assert.equal(form.get("model"), "Flux-2-Klein-4B");
  assert.equal(form.get("prompt"), "an outfit");
  assert.equal(form.get("size"), "896x1152");
  assert.equal(form.get("n"), "1");
  assert.equal(form.get("response_format"), "b64_json");
  const parts = form.getAll("image[]");
  assert.deepEqual(parts.map((part) => [part.name, part.type]), [["item-1.jpg", "image/jpeg"], ["item-2.jpg", "image/jpeg"]]);
  assert.equal(await parts[1].text(), "two");
  assert.equal(form.has("image"), false); // sending both fields is refused by the app
});

test("the default address is used when none is set, and a JPEG answer is recognised", async () => {
  const { fetchImpl, calls } = recorder(() => json(200, { data: [{ b64_json: "/9j/4AAQ" }] }));
  const out = await createLocalProvider({ model: "m", fetchImpl }).generate({ prompt: "p", images, aspectRatio: "1:1" });
  assert.equal(calls[0].url, `${LOCAL_DEFAULT_URL}/images/edits`);
  assert.equal(calls[0].init.body.get("size"), "1024x1024");
  assert.equal(out.mimeType, "image/jpeg");
});

test("the local app's failures are explained with what to do", async () => {
  const run = (respond) =>
    createLocalProvider({ model: "m", fetchImpl: recorder(respond).fetchImpl }).generate({ prompt: "p", images, aspectRatio: "1:1" });
  const fails = (respond, pattern) =>
    assert.rejects(run(respond), (error) => error instanceof ProviderError && pattern.test(error.message));

  await fails(() => { throw new TypeError("Failed to fetch"); }, /Lost touch with the app.*press Connect/);
  await fails(() => { throw new DOMException("timed out", "TimeoutError"); }, /took too long/);
  await fails(() => json(403, {}), /doesn't accept this website yet/);
  await fails(() => json(503, { error: "No current model is configured", code: "model_not_loaded" }), /model ready.*It said: No current model/);
  await fails(() => json(500, { error: { message: "out of memory" } }), /too large for it.*It said: out of memory/);
  await fails(() => json(200, { data: [] }), /answered without a picture/);
});

test("models that can combine pictures are listed, with size and whether they are downloaded", async () => {
  const { fetchImpl, calls } = recorder(() => json(200, CATALOG));
  const found = await findLocalModels("http://localhost:13305/v1", { fetchImpl });
  assert.equal(calls[0].url, "http://localhost:13305/v1/models?show_all=true");
  assert.deepEqual(found, {
    status: "connected",
    models: [
      { id: "Flux-2-Klein-9B-GGUF", sizeGb: 19.0, downloaded: false },
      { id: "Flux-2-Klein-4B", sizeGb: 16.1, downloaded: false },
    ],
  });
});

test("an app that labels nothing is taken to serve the one model it has", async () => {
  const single = { data: [{ id: "sd-cpp-local", object: "model", owned_by: "local" }] };
  const found = await findLocalModels("http://127.0.0.1:1234/v1", recorder(() => json(200, single)));
  assert.deepEqual(found, { status: "connected", models: [{ id: "sd-cpp-local", sizeGb: null, downloaded: true }] });
});

test("an app that is running but refuses this website is told apart from one that isn't there", async () => {
  // A cross-site refusal reaches a page as a failed request; a request that reads nothing still goes through.
  const refusing = recorder((url, init) => {
    if (init.mode === "no-cors") return new Response(null, { status: 200 });
    throw new TypeError("Failed to fetch");
  });
  assert.deepEqual(await findLocalModels(undefined, refusing), { status: "refused" });
  assert.equal(refusing.calls.length, 2);

  const absent = recorder(() => { throw new TypeError("Failed to fetch"); });
  assert.deepEqual(await findLocalModels(undefined, absent), { status: "unreachable" });

  assert.deepEqual(await findLocalModels(undefined, recorder(() => json(403, {}))), { status: "refused" });
  assert.deepEqual(await findLocalModels(undefined, recorder(() => json(500, {}))), { status: "unreachable" });
  assert.deepEqual(await findLocalModels(undefined, recorder(() => new Response("<html>", { status: 200 }))), { status: "unreachable" });
});

test("a download is requested by model name, and a quick refusal is reported", async () => {
  const accepted = recorder(() => new Promise(() => {})); // the app holds the request open while it downloads
  const started = startLocalDownload("http://localhost:13305/v1", "Flux-2-Klein-4B", accepted);
  assert.equal(await started, true);
  const { url, init } = accepted.calls[0];
  assert.equal(url, "http://localhost:13305/v1/pull");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body), { model_name: "Flux-2-Klein-4B", stream: false });

  assert.equal(await startLocalDownload(undefined, "m", recorder(() => json(200, { status: "success" }))), true);
  assert.equal(await startLocalDownload(undefined, "m", recorder(() => json(404, { error: "unknown model" }))), false);
  assert.equal(await startLocalDownload(undefined, "m", recorder(() => { throw new TypeError("Failed to fetch"); })), false);
});

test("the model offered first fits the computer, falling back to what the app has", () => {
  const models = [
    { id: "Flux-2-Klein-9B-GGUF", sizeGb: 19, downloaded: false },
    { id: "Flux-2-Klein-4B", sizeGb: 16.1, downloaded: false },
  ];
  assert.equal(pickLocalModel(models, "large"), "Flux-2-Klein-9B-GGUF");
  assert.equal(pickLocalModel(models, "small"), "Flux-2-Klein-4B");
  assert.equal(pickLocalModel(models, ""), "Flux-2-Klein-4B"); // no answer yet: the smallest download

  const others = [
    { id: "Big", sizeGb: 30, downloaded: false },
    { id: "Have", sizeGb: 20, downloaded: true },
  ];
  assert.equal(pickLocalModel(others, "medium"), "Have");
  assert.equal(pickLocalModel([], "medium"), null);
});

test("every kind of computer Setup asks about has advice and a model", () => {
  assert.deepEqual(Object.keys(LOCAL_TIERS).sort(), Object.keys(TIERS).sort());
  for (const tier of Object.values(LOCAL_TIERS)) assert.ok(tier.model && tier.advice);
});

test("the local choice needs a chosen model before it will make pictures", () => {
  assert.equal(PROVIDERS.local.local, true);
  assert.throws(() => createProvider({ provider: "local" }), (e) => e instanceof ProviderError && /in Setup/.test(e.message));
  const provider = createProvider({ provider: "local", localModel: "Flux-2-Klein-4B" });
  assert.deepEqual([provider.name, provider.model], ["local", "Flux-2-Klein-4B"]);
});
