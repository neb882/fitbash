import test from "node:test";
import assert from "node:assert/strict";

import {
  LOCAL_DEFAULT_URL,
  LOCAL_TIERS,
  createLocalProvider,
  findLocalModels,
  localMemoryCommand,
  pickLocalModel,
  readLocalDownloads,
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
    { id: "Flux-2-Klein-9B-GGUF", size: 19.0, downloaded: false, labels: ["image", "edit"], recipe: "sd-cpp", recipe_options: { steps: 4 } },
    // What the app lists once the memory-saving options were saved for a model.
    {
      id: "Flux-2-Klein-4B",
      size: 16.1,
      downloaded: false,
      labels: ["image", "edit"],
      recipe: "sd-cpp",
      recipe_options: { steps: 4, sdcpp_args: "--diffusion-fa --offload-to-cpu" },
    },
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

test("a model larger than the graphics card gets one line to paste, unless the app already has it", () => {
  const model = { id: "Flux-2-Klein-4B", recipe: "sd-cpp", memorySaving: false };
  // The line that made pictures work on a real 12 GB card (2026-11-25).
  assert.equal(
    localMemoryCommand(model),
    'lemonade load Flux-2-Klein-4B --sdcpp-args "--diffusion-fa --offload-to-cpu" --save-options',
  );
  assert.equal(localMemoryCommand({ ...model, memorySaving: true }), null);
  // Another engine, or an app that doesn't say, takes other options: no line is better than a wrong one.
  assert.equal(localMemoryCommand({ ...model, recipe: "thenoise" }), null);
  assert.equal(localMemoryCommand({ ...model, recipe: null }), null);
  assert.equal(localMemoryCommand(undefined), null);
  // A name that would do something else in a terminal is never put in the line.
  for (const id of ["x & calc", "x; rm -rf ~", "$(reboot)", "a b", "-m", 'x"y', ""]) {
    assert.equal(localMemoryCommand({ ...model, id }), null, id);
  }
  assert.match(localMemoryCommand({ ...model, id: "user.My-Model_2" }), /^lemonade load user\.My-Model_2 /);

  // Cards with less memory than the standard model's files are the ones that need it.
  assert.deepEqual(Object.keys(LOCAL_TIERS).filter((tier) => LOCAL_TIERS[tier].tight), ["small", "medium"]);
});

test("a model that combines only four pieces is not sent a fifth", async () => {
  // Seen with the real app: FLUX.2 klein, given five pieces, made a picture with two of them missing.
  const five = [...images, ...images, images[0]];
  for (const model of ["Flux-2-Klein-4B", "Flux-2-Klein-9B-GGUF"]) {
    const { fetchImpl, calls } = recorder(() => json(200, { data: [{ b64_json: PNG }] }));
    const provider = createLocalProvider({ model, fetchImpl });
    await assert.rejects(
      provider.generate({ prompt: "p", images: five, aspectRatio: "3:4" }),
      (error) => error instanceof ProviderError && /at most 4 pieces.*Remove one and try again, or choose a paid service/.test(error.message),
    );
    assert.equal(calls.length, 0, "nothing is sent, so no time is spent on a picture that would be wrong");
    await provider.generate({ prompt: "p", images: five.slice(0, 4), aspectRatio: "3:4" });
    assert.equal(calls.length, 1);
  }
  await assert.rejects(
    createLocalProvider({ model: "Flux-2-Klein-4B", fetchImpl: recorder(() => json(200, {})).fetchImpl }).generate({ prompt: "p", images: [...five, ...five], aspectRatio: "3:4" }),
    /Remove some and try again/,
  );
  // A model this page knows nothing about is sent whatever the person added.
  const other = recorder(() => json(200, { data: [{ b64_json: PNG }] }));
  await createLocalProvider({ model: "sd-cpp-local", fetchImpl: other.fetchImpl }).generate({ prompt: "p", images: five, aspectRatio: "3:4" });
  assert.equal(other.calls[0].init.body.getAll("image[]").length, 5);
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
  await fails(() => json(500, { error: { message: "something broke" } }), /fewer pieces.*too large for this computer.*It said: something broke/);
  await fails(() => json(500, { error: { message: "CUDA error: out of memory" } }), /ran out of memory.*fewer pieces.*It said: CUDA error/);

  // Seen with the real app (2026-11-25, a 12 GB NVIDIA card, three and five pieces): its own message is only
  // "sd-server request failed", and the picture engine's words travel in the details.
  const wrapped = (response) =>
    json(500, {
      error: { message: "sd-server request failed", type: "backend_error", details: { status_code: 500, response } },
    });
  await fails(
    () => wrapped({ error: "generate_image returned no results" }),
    /^The app on your computer couldn't make that picture\. Try again with fewer pieces.*\(It said: generate_image returned no results\)$/,
  );
  // The other shapes the details can take, from Lemonade's and the engine's source.
  await fails(() => wrapped({ error: "failed to allocate 9216 MiB" }), /ran out of memory.*It said: failed to allocate 9216 MiB\)$/);
  await fails(() => wrapped({ error: "server_error", message: "bad tensor shape" }), /It said: bad tensor shape\)$/);
  await fails(() => wrapped("plain words from the engine"), /It said: plain words from the engine\)$/);
  // With nothing more in the details, Lemonade's own message is still better than none.
  await fails(() => wrapped({}), /It said: sd-server request failed\)$/);
  await fails(() => wrapped(""), /It said: sd-server request failed\)$/);
  await fails(() => json(200, { data: [] }), /answered without a picture/);
});

test("models that can combine pictures are listed, with size and whether they are downloaded", async () => {
  const { fetchImpl, calls } = recorder(() => json(200, CATALOG));
  const found = await findLocalModels("http://localhost:13305/v1", { fetchImpl });
  assert.equal(calls[0].url, "http://localhost:13305/v1/models?show_all=true");
  assert.deepEqual(found, {
    status: "connected",
    models: [
      { id: "Flux-2-Klein-9B-GGUF", sizeGb: 19.0, downloaded: false, recipe: "sd-cpp", memorySaving: false },
      { id: "Flux-2-Klein-4B", sizeGb: 16.1, downloaded: false, recipe: "sd-cpp", memorySaving: true },
    ],
  });
});

test("an app that labels nothing is taken to serve the one model it has", async () => {
  const single = { data: [{ id: "sd-cpp-local", object: "model", owned_by: "local" }] };
  const found = await findLocalModels("http://127.0.0.1:1234/v1", recorder(() => json(200, single)));
  assert.deepEqual(found, { status: "connected", models: [{ id: "sd-cpp-local", sizeGb: null, downloaded: true, recipe: null, memorySaving: false }] });
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

// A download job as Lemonade documents it (2026-11): what /v1/pull answers at once and /v1/downloads lists.
const job = (fields = {}) => ({
  id: "model:Flux-2-Klein-4B",
  type: "model",
  model_name: "Flux-2-Klein-4B",
  status: "downloading",
  running: true,
  file: "flux-2-klein-4b.safetensors",
  file_index: 2,
  total_files: 3,
  bytes_downloaded: 1_200_000_000,
  bytes_total: 7_750_000_000,
  percent: 15,
  total_download_size: 16_100_000_000,
  bytes_previously_downloaded: 0,
  completed_files_bytes: 2_000_000_000,
  cumulative_bytes_downloaded: 3_200_000_000,
  overall_bytes_downloaded: 3_200_000_000,
  complete: false,
  ...fields,
});

test("a download is handed to the app to look after, and a refusal comes back with the app's words", async () => {
  const accepted = recorder(() => json(200, job({ cumulative_bytes_downloaded: 0, total_download_size: 0 })));
  assert.deepEqual(await startLocalDownload("http://localhost:13305/v1", "Flux-2-Klein-4B", accepted), { started: true });
  const { url, init } = accepted.calls[0];
  assert.equal(url, "http://localhost:13305/v1/pull");
  assert.equal(init.method, "POST");
  // Without `subscribe: false` the app ties the download to the request and ends it when the page goes.
  assert.deepEqual(JSON.parse(init.body), { model_name: "Flux-2-Klein-4B", stream: true, subscribe: false });

  const start = (respond) => startLocalDownload(undefined, "m", recorder(respond));
  assert.deepEqual(await start(() => json(400, { error: { message: "Server is offline", code: "lemond_offline" } })), {
    started: false,
    reason: "Server is offline",
  });
  assert.deepEqual(await start(() => json(200, job({ status: "error", error: "Model not found", code: "unknown_model" }))), {
    started: false,
    reason: "Model not found",
  });
  assert.deepEqual(await start(() => { throw new TypeError("Failed to fetch"); }), { started: false, reason: "" });
  // A stream of events is a download tied to this request: it stays open for as long as the
  // download takes, and ends the download when the page stops reading. The page lets go of it at once.
  let letGo = false;
  const events = new ReadableStream({
    start: (controller) => controller.enqueue(new TextEncoder().encode("event: progress\ndata: {}\n\n")),
    cancel: () => { letGo = true; },
  });
  const stream = () => new Response(events, { headers: { "content-type": "text/event-stream" } });
  assert.deepEqual(await start(stream), { started: false, reason: "" });
  assert.equal(letGo, true);
});

test("the app's downloads are read as how far each has got", async () => {
  const listed = recorder(() =>
    json(200, [
      // The app lists downloads of its own parts too; those are not models.
      job({ id: "backend:sd-cpp:vulkan", type: "backend", model_name: "sd-cpp:vulkan" }),
      job(),
      job({ model_name: "Paused", status: "paused" }),
      job({ model_name: "Stopped", status: "cancelled" }),
      job({ model_name: "Done", status: "completed", complete: true }),
      job({ model_name: "Broken", status: "error", error: "disk full" }),
      job({ model_name: "Starting", total_download_size: 0, cumulative_bytes_downloaded: 0, overall_bytes_downloaded: 0 }),
      // An older app names the count differently.
      job({ model_name: "Older", cumulative_bytes_downloaded: undefined, overall_bytes_downloaded: 500 }),
      // A state added since this was written: still going while the app is working on it, over when it isn't.
      job({ model_name: "Checking", status: "verifying", running: true }),
      job({ model_name: "Checked", status: "verifying", running: false }),
    ]),
  );
  const jobs = await readLocalDownloads("http://localhost:13305/v1/", listed);
  assert.equal(listed.calls[0].url, "http://localhost:13305/v1/downloads");
  assert.deepEqual(jobs, [
    { modelId: "Flux-2-Klein-4B", state: "downloading", doneBytes: 3_200_000_000, totalBytes: 16_100_000_000, error: "" },
    { modelId: "Paused", state: "paused", doneBytes: 3_200_000_000, totalBytes: 16_100_000_000, error: "" },
    { modelId: "Stopped", state: "cancelled", doneBytes: 3_200_000_000, totalBytes: 16_100_000_000, error: "" },
    { modelId: "Done", state: "done", doneBytes: 3_200_000_000, totalBytes: 16_100_000_000, error: "" },
    { modelId: "Broken", state: "failed", doneBytes: 3_200_000_000, totalBytes: 16_100_000_000, error: "disk full" },
    { modelId: "Starting", state: "downloading", doneBytes: 0, totalBytes: 0, error: "" },
    { modelId: "Older", state: "downloading", doneBytes: 500, totalBytes: 16_100_000_000, error: "" },
    { modelId: "Checking", state: "downloading", doneBytes: 3_200_000_000, totalBytes: 16_100_000_000, error: "" },
    { modelId: "Checked", state: "done", doneBytes: 3_200_000_000, totalBytes: 16_100_000_000, error: "" },
  ]);
});

test("an app that has gone is told apart from one whose downloads can't be read", async () => {
  assert.equal(await readLocalDownloads(undefined, recorder(() => { throw new TypeError("Failed to fetch"); })), null);
  assert.deepEqual(await readLocalDownloads(undefined, recorder(() => json(404, { error: {} }))), []);
  assert.deepEqual(await readLocalDownloads(undefined, recorder(() => new Response("<html>", { status: 200 }))), []);
  assert.deepEqual(await readLocalDownloads(undefined, recorder(() => json(200, { jobs: [] }))), []);
  assert.deepEqual(await readLocalDownloads(undefined, recorder(() => json(200, [null, "x", {}]))), []);
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
