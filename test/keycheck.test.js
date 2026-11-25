import test from "node:test";
import assert from "node:assert/strict";

import { checkKey } from "../public/lib/keycheck.js";

function respond(status, body = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

test("a Google key is checked by listing models, which costs nothing", async () => {
  const good = respond(200, { models: [] });
  assert.equal(await checkKey("gemini", "g-key", good), "ok");
  assert.match(good.calls[0].url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models/);
  assert.equal(good.calls[0].headers.get("x-goog-api-key"), "g-key");

  assert.equal(await checkKey("gemini", "bad", respond(400)), "rejected");
  assert.equal(await checkKey("gemini", "bad", respond(403)), "rejected");
  assert.equal(await checkKey("gemini", "g-key", respond(503)), "unknown");
});

test("an OpenAI key is checked the same way", async () => {
  const good = respond(200, { data: [] });
  assert.equal(await checkKey("openai", "o-key", good), "ok");
  assert.equal(good.calls[0].url, "https://api.openai.com/v1/models");
  assert.equal(good.calls[0].headers.get("authorization"), "Bearer o-key");
  assert.equal(await checkKey("openai", "bad", respond(401)), "rejected");
});

test("a Claude key is checked through the SDK", async () => {
  const good = respond(200, { data: [], has_more: false, first_id: null, last_id: null });
  assert.equal(await checkKey("claude", "c-key", good), "ok");
  assert.match(good.calls[0].url, /\/v1\/models\?limit=1/);
  assert.equal(good.calls[0].headers.get("authorization"), "Bearer c-key");

  const bad = respond(401, { type: "error", error: { type: "authentication_error", message: "invalid key" } });
  assert.equal(await checkKey("claude", "bad", bad), "rejected");
  assert.equal(await checkKey("claude", "c-key", respond(529, { type: "error", error: { type: "overloaded_error", message: "busy" } })), "unknown");
});

test("no connection means the answer is unknown, not a rejection", async () => {
  const offline = { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } };
  assert.equal(await checkKey("gemini", "k", offline), "unknown");
  assert.equal(await checkKey("openai", "k", offline), "unknown");
  assert.equal(await checkKey("claude", "k", offline), "unknown");
});
