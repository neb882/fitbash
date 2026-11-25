import test from "node:test";
import assert from "node:assert/strict";

import { createGeminiProvider, parseGeminiImage } from "../src/providers/gemini.js";
import { createOpenAIProvider } from "../src/providers/openai.js";
import { createMockProvider } from "../src/providers/mock.js";
import { createProvider, ProviderError } from "../src/providers/index.js";
import { loadConfig } from "../src/config.js";

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
  assert.equal(calls[0].init.headers["x-goog-api-key"], "g-key");
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
    [401, /rejected the API key/],
    [429, /rate limiting|out of credit/],
    [503, /having trouble/],
    [400, /couldn't make that picture.*bad prompt/],
  ];
  for (const [status, pattern] of cases) {
    const { impl } = fakeFetch(status, { error: { message: "bad prompt" } });
    const provider = createOpenAIProvider({ apiKey: "k", model: "m", fetchImpl: impl });
    await assert.rejects(
      provider.generate({ prompt: "p", images, aspectRatio: "1:1" }),
      (error) => error instanceof ProviderError && error.status === status && pattern.test(error.message),
    );
  }
});

test("the mock provider returns an SVG collage holding every picture", async () => {
  const out = await createMockProvider().generate({ prompt: "p", images, aspectRatio: "1:1" });
  assert.equal(out.mimeType, "image/svg+xml");
  const svg = Buffer.from(out.data, "base64").toString();
  assert.equal(svg.match(/<image /g).length, 2);
  assert.ok(svg.includes(images[1].data));
});

test("the configured provider is built, and a missing key is reported", () => {
  assert.equal(createProvider(loadConfig({})).name, "mock");
  assert.equal(createProvider(loadConfig({ FITBASH_PROVIDER: "gemini", GEMINI_API_KEY: "k" })).name, "gemini");
  assert.equal(createProvider(loadConfig({ FITBASH_PROVIDER: "OpenAI", OPENAI_API_KEY: "k" })).name, "openai");
  assert.throws(() => createProvider(loadConfig({ FITBASH_PROVIDER: "gemini" })), /GEMINI_API_KEY/);
  assert.throws(() => createProvider(loadConfig({ FITBASH_PROVIDER: "dalle" })), /Unknown FITBASH_PROVIDER/);
});

test("config clamps the attempt cap and turns the check on only with a Claude key", () => {
  assert.equal(loadConfig({}).maxAttempts, 2);
  assert.equal(loadConfig({ FITBASH_MAX_ATTEMPTS: "99" }).maxAttempts, 4);
  assert.equal(loadConfig({ FITBASH_MAX_ATTEMPTS: "0" }).maxAttempts, 1);
  assert.equal(loadConfig({}).criticEnabled, false);
  assert.equal(loadConfig({ ANTHROPIC_API_KEY: "k" }).criticEnabled, true);
});
