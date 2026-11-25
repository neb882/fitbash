import test from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";

import { createCritic } from "../src/critic.js";

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
    /key was rejected/,
  );
  assert.match(
    (await run(() => { throw new Anthropic.RateLimitError(429, {}, "slow down", new Headers()); })).reason,
    /rate limited/,
  );
  assert.match(
    (await run(() => { throw new Anthropic.InternalServerError(500, {}, "boom", new Headers()); })).reason,
    /API error 500/,
  );
  assert.match((await run(() => { throw new TypeError("socket"); })).reason, /unexpectedly/);
});
