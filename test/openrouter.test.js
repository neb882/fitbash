import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createOpenRouterProvider, OPENROUTER_MODELS } from "../public/lib/providers/openrouter.js";
import { createProvider, PROVIDERS, ProviderError } from "../public/lib/providers/index.js";
import { beginConnect, challengeFor, finishConnect } from "../public/lib/openrouter-connect.js";

const images = [
  { mimeType: "image/jpeg", data: "AAAA" },
  { mimeType: "image/jpeg", data: "BBBB" },
];
const PNG = "iVBORw0KGgoAAAANSUhEUg";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function recorder(respond) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return respond(String(url), init);
    },
  };
}
const make = (model, respond) => {
  const { fetchImpl, calls } = recorder(respond);
  return { provider: createOpenRouterProvider({ apiKey: "or-key", model, fetchImpl }), calls };
};

test("the pieces go to OpenRouter as reference pictures, and the picture comes back as data", async () => {
  const { provider, calls } = make("openai/gpt-image-2.5-sunburst", () => json(200, { data: [{ b64_json: PNG, media_type: "image/png" }] }));
  const out = await provider.generate({ prompt: "an outfit", images, aspectRatio: "3:4" });

  assert.deepEqual(out, { mimeType: "image/png", data: PNG });
  const { url, init } = calls[0];
  assert.equal(url, "https://openrouter.ai/api/v1/images");
  assert.deepEqual(init.headers, { authorization: "Bearer or-key", "content-type": "application/json" });
  assert.deepEqual(JSON.parse(init.body), {
    model: "openai/gpt-image-2.5-sunburst",
    prompt: "an outfit",
    input_references: [
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,BBBB" } },
    ],
    aspect_ratio: "3:4",
    n: 1,
    response_format: "b64_json",
    quality: "medium",
  });
});

test("each listed model is sent the options that keep a picture to cents, and an unlisted one only the basics", async () => {
  const sent = async (model) => {
    const { provider, calls } = make(model, () => json(200, { data: [{ b64_json: PNG }] }));
    await provider.generate({ prompt: "p", images, aspectRatio: "1:1" });
    const { model: _model, prompt, input_references, aspect_ratio, n, response_format, ...extra } = JSON.parse(calls[0].init.body);
    return extra;
  };
  assert.deepEqual(await sent("google/gemini-nano-banana-2.1"), { resolution: "1K" });
  assert.deepEqual(await sent("microsoft/mai-image-2.7"), {});
  assert.deepEqual(await sent("someone/a-model-typed-under-advanced"), {});
});

test("a model that takes fewer pieces than were added says so before anything is sent", async () => {
  const six = Array(6).fill(images[0]);
  const { provider, calls } = make("microsoft/mai-image-2.7", () => json(200, { data: [{ b64_json: PNG }] }));
  await assert.rejects(provider.generate({ prompt: "p", images: six, aspectRatio: "1:1" }), /takes at most 5 pieces/);
  assert.equal(calls.length, 0);
  await provider.generate({ prompt: "p", images: six.slice(0, 5), aspectRatio: "1:1" });
  assert.equal(calls.length, 1);
});

test("OpenRouter's failures are explained with what to do", async () => {
  const fails = async (respond, pattern) => {
    const { provider } = make("google/gemini-nano-banana-2.1", respond);
    await assert.rejects(
      provider.generate({ prompt: "p", images, aspectRatio: "1:1" }),
      (error) => error instanceof ProviderError && pattern.test(error.message),
      String(pattern),
    );
  };
  const error = (code, message, metadata) => () => json(code, { error: { code, message, ...(metadata ? { metadata } : {}) } });
  await fails(error(401, "User not found."), /didn't accept your key.*OpenRouter said: User not found/);
  await fails(error(402, "Insufficient credits", { limit_source: "openrouter_credits" }), /needs credit/);
  await fails(error(402, "Budget in flight", { limit_source: "openrouter_in_flight_budget" }), /still settling/);
  await fails(error(403, "Key limit exceeded", { limit_source: "openrouter_key_limit" }), /spending limit/);
  await fails(error(403, "Flagged by moderation"), /refused these pictures/);
  await fails(error(429, "Slow down"), /too many requests/);
  await fails(error(503, "No available provider"), /isn't answering.*choose another model/);
  await fails(error(400, "No such model"), /model name under Advanced/);
  // A failure part-way through can arrive as a 200 with an error inside.
  await fails(() => json(200, { error: { code: 502, message: "Provider returned an error" } }), /isn't answering/);
  await fails(() => json(200, { data: [{ url: "https://storage.example/picture.png" }] }), /without a picture/);
  await fails(() => new Response("<html>bad gateway</html>", { status: 502 }), /isn't answering/);
  await fails(() => { throw new TypeError("Failed to fetch"); }, /OpenRouter couldn't be reached/);
});

test("the shortlist starts with the suggested model, and every entry says how many pieces it takes", () => {
  assert.equal(PROVIDERS.openrouter.defaultModel, OPENROUTER_MODELS[0].id);
  assert.equal(new Set(OPENROUTER_MODELS.map((model) => model.id)).size, OPENROUTER_MODELS.length);
  for (const model of OPENROUTER_MODELS) {
    assert.match(model.id, /^[a-z0-9-]+\/[a-z0-9.-]+$/, model.id);
    assert.ok(model.label && model.maxPieces >= 2, model.id);
  }
  assert.throws(() => createProvider({ provider: "openrouter" }), /OpenRouter key in Setup/);
  const chosen = createProvider({ provider: "openrouter", openrouterKey: "k" });
  assert.deepEqual([chosen.name, chosen.model], ["openrouter", OPENROUTER_MODELS[0].id]);
});

// ---- signing in instead of pasting a key ----

function memory() {
  const kept = new Map();
  return { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v), removeItem: (k) => kept.delete(k), kept };
}

test("a sign-in sends the visitor to OpenRouter with a fingerprint of a secret this tab keeps", async () => {
  const storage = memory();
  let went;
  await beginConnect({ callbackUrl: "https://example.test/fitbash/", storage, go: (url) => (went = new URL(url)) });

  assert.equal(went.origin + went.pathname, "https://openrouter.ai/auth");
  assert.equal(went.searchParams.get("callback_url"), "https://example.test/fitbash/");
  assert.equal(went.searchParams.get("code_challenge_method"), "S256");
  const [verifier] = [...storage.kept.values()];
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  // The fingerprint is base64url(SHA-256(secret)), computed here a second way.
  assert.equal(went.searchParams.get("code_challenge"), createHash("sha256").update(verifier).digest("base64url"));
  assert.equal(await challengeFor("abc"), createHash("sha256").update("abc").digest("base64url"));
});

test("coming back with a code trades it and the secret for a key, once", async () => {
  const storage = memory();
  await beginConnect({ callbackUrl: "https://example.test/", storage, go: () => {} });
  const [verifier] = [...storage.kept.values()];
  const { fetchImpl, calls } = recorder(() => json(200, { key: "sk-or-v1-new" }));

  const key = await finishConnect({ url: "https://example.test/?code=ONE-TIME", storage, fetchImpl });
  assert.equal(key, "sk-or-v1-new");
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/auth/keys");
  assert.deepEqual(JSON.parse(calls[0].init.body), { code: "ONE-TIME", code_verifier: verifier, code_challenge_method: "S256" });
  // The secret is gone: the same address opened again starts nothing.
  assert.equal(await finishConnect({ url: "https://example.test/?code=ONE-TIME", storage, fetchImpl }), null);
  assert.equal(calls.length, 1);
});

test("an ordinary page load, or a code with no sign-in under way, is left alone", async () => {
  const { fetchImpl, calls } = recorder(() => json(200, { key: "k" }));
  assert.equal(await finishConnect({ url: "https://example.test/", storage: memory(), fetchImpl }), null);
  assert.equal(await finishConnect({ url: "https://example.test/?code=STRAY", storage: memory(), fetchImpl }), null);
  const blocked = { getItem() { throw new Error("no storage"); }, removeItem() {} };
  assert.equal(await finishConnect({ url: "https://example.test/?code=X", storage: blocked, fetchImpl }), null);
  assert.equal(calls.length, 0);
});

test("a sign-in OpenRouter does not honour is reported, not taken for a key", async () => {
  for (const respond of [() => json(400, { error: { message: "Invalid code", code: 400 } }), () => json(200, {}), () => new Response("oops", { status: 200 })]) {
    const storage = memory();
    await beginConnect({ callbackUrl: "https://example.test/", storage, go: () => {} });
    await assert.rejects(finishConnect({ url: "https://example.test/?code=C", storage, fetchImpl: recorder(respond).fetchImpl }), /did not hand over a key/);
  }
});
