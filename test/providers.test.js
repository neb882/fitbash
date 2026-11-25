import test from "node:test";
import assert from "node:assert/strict";

import { createGeminiProvider, parseGeminiImage } from "../public/lib/providers/gemini.js";
import { createOpenAIProvider } from "../public/lib/providers/openai.js";
import { createMockProvider } from "../public/lib/providers/mock.js";
import { createProvider, PROVIDERS, DEFAULT_PROVIDER, ProviderError } from "../public/lib/providers/index.js";

const images = [
  { mimeType: "image/jpeg", data: Buffer.from("one").toString("base64") },
  { mimeType: "image/png", data: Buffer.from("two").toString("base64") },
];

function fakeFetch(status, body) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

test("gemini sends the prompt and every picture, and reads the picture back", async () => {
  const { impl, calls } = fakeFetch(200, {
    steps: [
      { type: "thought", summary: [{ type: "image", data: "DRAFT" }] },
      { type: "model_output", content: [{ type: "text", text: "Here you go" }, { type: "image", mime_type: "image/jpeg", data: "FINAL" }] },
    ],
  });
  const provider = createGeminiProvider({ apiKey: "g-key", model: "some-model", fetchImpl: impl });
  const out = await provider.generate({ prompt: "an outfit", images, aspectRatio: "3:4" });

  assert.deepEqual(out, { mimeType: "image/jpeg", data: "FINAL" });
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  // Browsers may send only these two headers to the Gemini API.
  assert.deepEqual(calls[0].init.headers, { "content-type": "application/json", "x-goog-api-key": "g-key" });
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: "some-model",
    input: [
      { type: "text", text: "an outfit" },
      { type: "image", mime_type: "image/jpeg", data: images[0].data },
      { type: "image", mime_type: "image/png", data: images[1].data },
    ],
    response_format: { type: "image", aspect_ratio: "3:4" },
  });
});

test("gemini reports an answer with no picture", async () => {
  assert.equal(parseGeminiImage({ steps: [{ type: "model_output", content: [{ type: "text", text: "no" }] }] }), null);
  assert.equal(parseGeminiImage({}), null);
  const { impl } = fakeFetch(200, { steps: [] });
  const provider = createGeminiProvider({ apiKey: "k", model: "m", fetchImpl: impl });
  await assert.rejects(provider.generate({ prompt: "p", images, aspectRatio: "1:1" }), ProviderError);
});

test("openai sends a multipart edit with one image[] part per picture", async () => {
  const { impl, calls } = fakeFetch(200, { data: [{ b64_json: "PNGB64" }] });
  const provider = createOpenAIProvider({ apiKey: "o-key", model: "img-model", quality: "medium", fetchImpl: impl });
  const out = await provider.generate({ prompt: "an outfit", images, aspectRatio: "3:4" });

  assert.deepEqual(out, { mimeType: "image/png", data: "PNGB64" });
  const { url, init } = calls[0];
  assert.equal(url, "https://api.openai.com/v1/images/edits");
  assert.equal(init.headers.authorization, "Bearer o-key");
  assert.equal(init.body.get("model"), "img-model");
  assert.equal(init.body.get("prompt"), "an outfit");
  assert.equal(init.body.get("size"), "1024x1536");
  assert.equal(init.body.get("quality"), "medium");
  const parts = init.body.getAll("image[]");
  assert.deepEqual(parts.map((p) => [p.name, p.type]), [["item-1.jpg", "image/jpeg"], ["item-2.png", "image/png"]]);
  assert.equal(await parts[0].text(), "one");
});

test("API errors become messages a person can act on", async () => {
  const cases = [
    [401, "Incorrect API key", /OpenAI didn't accept your key\. Check it in Setup/],
    [429, "Rate limit reached", /too many requests.*Wait a minute/],
    [429, "You exceeded your current quota, please check your plan and billing details", /no credit left/],
    [403, "Your organization must be verified to use this model", /identity verified/],
    [404, "The model does not exist", /renamed: see Advanced in Setup/],
    [503, "overloaded", /having trouble/],
    [400, "bad prompt", /couldn't make that picture\. \(OpenAI said: bad prompt\)/],
  ];
  for (const [status, message, pattern] of cases) {
    const { impl } = fakeFetch(status, { error: { message } });
    const provider = createOpenAIProvider({ apiKey: "k", model: "m", fetchImpl: impl });
    await assert.rejects(
      provider.generate({ prompt: "p", images, aspectRatio: "1:1" }),
      (error) => error instanceof ProviderError && error.status === status && pattern.test(error.message),
      `${status} ${message}`,
    );
  }

  const google = (status, message) =>
    createGeminiProvider({ apiKey: "k", model: "m", fetchImpl: fakeFetch(status, { error: { message } }).impl })
      .generate({ prompt: "p", images, aspectRatio: "1:1" });
  await assert.rejects(google(429, "Quota exceeded for metric generate_content_free_tier_requests, limit: 0"), /until billing is turned on/);
  await assert.rejects(google(400, "API key not valid. Please pass a valid API key."), /Google didn't accept your key/);
});

test("the mock provider returns an SVG collage holding every picture", async () => {
  const out = await createMockProvider().generate({ prompt: "p", images, aspectRatio: "1:1" });
  assert.equal(out.mimeType, "image/svg+xml");
  const svg = Buffer.from(out.data, "base64").toString();
  assert.equal(svg.match(/<image /g).length, 2);
  assert.ok(svg.includes(images[1].data));
});

test("the picture format is read from the data when Gemini doesn't name it", () => {
  const body = (data) => ({ steps: [{ type: "model_output", content: [{ type: "image", data }] }] });
  assert.equal(parseGeminiImage(body("/9j/4AAQ")).mimeType, "image/jpeg");
  assert.equal(parseGeminiImage(body("UklGRiQA")).mimeType, "image/webp");
  assert.equal(parseGeminiImage(body("iVBORw0K")).mimeType, "image/png");
});

test("a dropped connection or timeout becomes a readable error", async () => {
  const offline = async () => { throw new TypeError("Failed to fetch"); };
  const slow = async () => { throw new DOMException("timed out", "TimeoutError"); };
  await assert.rejects(
    createGeminiProvider({ apiKey: "k", model: "m", fetchImpl: offline }).generate({ prompt: "p", images, aspectRatio: "1:1" }),
    (error) => error instanceof ProviderError && /Google couldn't be reached/.test(error.message),
  );
  await assert.rejects(
    createOpenAIProvider({ apiKey: "k", model: "m", fetchImpl: slow }).generate({ prompt: "p", images, aspectRatio: "1:1" }),
    (error) => error instanceof ProviderError && /OpenAI took too long/.test(error.message),
  );
});

test("the chosen provider is built with its default model, and a missing key is reported", () => {
  assert.equal(createProvider({ provider: "mock" }).name, "mock");
  assert.equal(createProvider({ provider: "something-else" }).name, "mock");
  assert.equal(PROVIDERS[DEFAULT_PROVIDER].label, "Google Gemini");
  const gemini = createProvider({ provider: "gemini", geminiKey: "k" });
  assert.deepEqual([gemini.name, gemini.model], ["gemini", PROVIDERS.gemini.defaultModel]);
  const openai = createProvider({ provider: "openai", openaiKey: "k", openaiModel: "custom" });
  assert.deepEqual([openai.name, openai.model], ["openai", "custom"]);
  assert.throws(() => createProvider({ provider: "gemini" }), (e) => e instanceof ProviderError && /Google key in Setup/.test(e.message));
  assert.throws(() => createProvider({ provider: "openai", geminiKey: "k" }), /OpenAI key in Setup/);
});
