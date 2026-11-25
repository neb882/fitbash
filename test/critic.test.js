import test from "node:test";
import assert from "node:assert/strict";
// The same copy of the SDK the page loads, so error classes match.
import { Anthropic } from "../public/vendor/anthropic-sdk.js";

import { createCritic } from "../public/lib/critic.js";

const items = [
  { mimeType: "image/jpeg", data: "AAAA", label: "frog tee" },
  { mimeType: "image/png", data: "BBBB", label: "" },
];
const generated = { mimeType: "image/png", data: "CCCC" };

function fakeClient(respond) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        parse: async (params) => {
          calls.push(params);
          return respond(params);
        },
      },
    },
  };
}

const parsed = {
  items: [
    { number: 1, present: true, faithful: false, problem: "frog redrawn as a toad" },
    { number: 2, present: true, faithful: true, problem: "" },
  ],
  other_problems: "",
  score: 14,
  verdict: "fail",
  fix_instructions: "Item 1: copy the frog print exactly.",
};

test("the check sends every reference and the generated picture, and maps the answer", async () => {
  const client = fakeClient(() => ({ stop_reason: "end_turn", parsed_output: parsed }));
  const critic = createCritic({ model: "claude-opus-5-5", client });
  const review = await critic.review({ items, generated, fillGaps: false });

  assert.deepEqual(review, {
    status: "reviewed",
    verdict: "fail",
    score: 10, // clamped into 1..10
    items: parsed.items,
    otherProblems: "",
    fix: "Item 1: copy the frog print exactly.",
  });

  const [params] = client.calls;
  assert.equal(params.model, "claude-opus-5-5");
  assert.equal(params.fallbacks, "default");
  assert.equal(params.output_config.effort, "medium");
  assert.ok(params.output_config.format);
  const content = params.messages[0].content;
  assert.deepEqual(content.map((block) => block.type), ["text", "image", "text", "image", "text", "image", "text"]);
  assert.equal(content[0].text, "Reference item 1: frog tee");
  assert.equal(content[2].text, "Reference item 2: clothing item");
  assert.deepEqual(content[5].source, { type: "base64", media_type: "image/png", data: "CCCC" });
  assert.match(content[6].text, /only the supplied items/);
});

test("the closing instruction reflects the fill-gaps choice", async () => {
  const client = fakeClient(() => ({ stop_reason: "end_turn", parsed_output: { ...parsed, verdict: "pass", score: 9 } }));
  await createCritic({ model: "m", client }).review({ items, generated, fillGaps: true });
  assert.match(client.calls[0].messages[0].content.at(-1).text, /allowed the image model to add plain basics/);
});

test("pictures the check can't read are skipped without an API call", async () => {
  const client = fakeClient(() => assert.fail("should not be called"));
  const critic = createCritic({ model: "m", client });
  const svg = await critic.review({ items, generated: { mimeType: "image/svg+xml", data: "AAAA" }, fillGaps: true });
  assert.equal(svg.status, "skipped");
  const huge = await critic.review({ items, generated: { mimeType: "image/png", data: "A".repeat(5 * 1024 * 1024 + 1) }, fillGaps: true });
  assert.equal(huge.status, "skipped");
  assert.equal(client.calls.length, 0);
});

test("refusals, unreadable answers and API errors are reported as skipped, never thrown", async () => {
  const run = (respond) => createCritic({ model: "m", client: fakeClient(respond) }).review({ items, generated, fillGaps: true });

  assert.match((await run(() => ({ stop_reason: "refusal", parsed_output: null }))).reason, /declined/);
  assert.match((await run(() => ({ stop_reason: "end_turn", parsed_output: null }))).reason, /unreadable/);
  assert.match(
    (await run(() => { throw new Anthropic.AuthenticationError(401, {}, "nope", new Headers()); })).reason,
    /rejected the API key/,
  );
  assert.match(
    (await run(() => { throw new Anthropic.RateLimitError(429, {}, "slow down", new Headers()); })).reason,
    /rate limited/,
  );
  assert.match(
    (await run(() => { throw new Anthropic.InternalServerError(500, {}, "boom", new Headers()); })).reason,
    /API error 500/,
  );
  assert.match((await run(() => { throw new Anthropic.APIConnectionError({ message: "offline" }); })).reason, /couldn't reach Anthropic/);
  assert.match((await run(() => { throw new TypeError("socket"); })).reason, /unexpectedly/);
});

test("the browser copy of the SDK builds a real request from the check's schema", async () => {
  // No fake client here: the real SDK runs, with only the network stubbed out.
  let sent;
  const answer = { ...parsed, score: 7 };
  const client = new Anthropic({
    apiKey: "test-key",
    baseURL: "https://api.anthropic.com",
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    fetch: async (url, init) => {
      sent = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
      return new Response(
        JSON.stringify({
          id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
          content: [{ type: "text", text: JSON.stringify(answer) }],
          stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  const review = await createCritic({ model: "claude-opus-5-5", client }).review({ items, generated, fillGaps: true });

  assert.equal(review.status, "reviewed");
  assert.equal(review.score, 7);
  assert.equal(review.fix, "Item 1: copy the frog print exactly.");
  assert.match(sent.url, /^https:\/\/api\.anthropic\.com\/v1\/messages/);
  assert.equal(sent.headers.get("authorization"), "Bearer test-key");
  assert.equal(sent.headers.get("anthropic-dangerous-direct-browser-access"), "true");
  assert.match(sent.headers.get("anthropic-beta"), /server-side-fallback-2026-07-01/);
  assert.equal(sent.body.fallbacks, "default");
  assert.equal(sent.body.output_config.format.type, "json_schema");
  assert.deepEqual(sent.body.output_config.format.schema.required, ["items", "other_problems", "score", "verdict", "fix_instructions"]);
});
