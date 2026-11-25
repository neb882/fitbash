import test from "node:test";
import assert from "node:assert/strict";

import { runOutfit, pickBest } from "../src/pipeline.js";
import { ProviderError } from "../src/providers/errors.js";

const request = {
  items: [{ mimeType: "image/jpeg", data: "AAAA", label: "frog tee" }],
  style: "model",
  fillGaps: true,
  notes: "",
};

function fakeProvider(results) {
  const calls = [];
  return {
    calls,
    name: "fake",
    async generate(args) {
      calls.push(args);
      const next = results[calls.length - 1];
      if (next instanceof Error) throw next;
      return next ?? { mimeType: "image/png", data: `IMG${calls.length}` };
    },
  };
}

function fakeCritic(reviews) {
  let n = 0;
  return { calls: () => n, review: async () => reviews[n++] };
}

const pass = (score = 9) => ({ status: "reviewed", verdict: "pass", score, items: [], otherProblems: "", fix: "" });
const fail = (score, fix = "Item 1: the print is wrong") => ({
  status: "reviewed",
  verdict: "fail",
  score,
  items: [{ number: 1, present: true, faithful: false, problem: "print redrawn" }],
  otherProblems: "",
  fix,
});

async function collect(generator) {
  const events = [];
  for await (const event of generator) events.push(event);
  return events;
}

test("without a check, one picture is made and returned", async () => {
  const provider = fakeProvider([]);
  const events = await collect(runOutfit(request, { provider, maxAttempts: 3 }));
  assert.deepEqual(events.map((e) => e.type), ["generating", "image", "done"]);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].aspectRatio, "3:4");
  assert.deepEqual(provider.calls[0].images, [{ mimeType: "image/jpeg", data: "AAAA" }]);
  assert.deepEqual(events.at(-1), { type: "done", best: 1, attempts: 1 });
});

test("a picture that passes the check ends the loop", async () => {
  const provider = fakeProvider([]);
  const critic = fakeCritic([pass()]);
  const events = await collect(runOutfit(request, { provider, critic, maxAttempts: 3 }));
  assert.deepEqual(events.map((e) => e.type), ["generating", "image", "checking", "review", "done"]);
  assert.equal(provider.calls.length, 1);
});

test("a failed check triggers a redo that carries the check's notes", async () => {
  const provider = fakeProvider([]);
  const critic = fakeCritic([fail(4), pass(8)]);
  const events = await collect(runOutfit(request, { provider, critic, maxAttempts: 3 }));
  assert.equal(provider.calls.length, 2);
  assert.doesNotMatch(provider.calls[0].prompt, /earlier attempt/);
  assert.match(provider.calls[1].prompt, /earlier attempt[\s\S]*Item 1: the print is wrong/);
  assert.deepEqual(events.at(-1), { type: "done", best: 2, attempts: 2 });
});

test("the loop stops at the attempt cap and picks the best-scored picture", async () => {
  const provider = fakeProvider([]);
  const critic = fakeCritic([fail(6), fail(3), fail(5)]);
  const events = await collect(runOutfit(request, { provider, critic, maxAttempts: 2 }));
  assert.equal(provider.calls.length, 2);
  assert.equal(critic.calls(), 2);
  assert.deepEqual(events.at(-1), { type: "done", best: 1, attempts: 2 });
});

test("problems are described when the check gives no fix text", async () => {
  const provider = fakeProvider([]);
  const critic = fakeCritic([fail(4, ""), pass()]);
  await collect(runOutfit(request, { provider, critic, maxAttempts: 2 }));
  assert.match(provider.calls[1].prompt, /Item 1: print redrawn/);
});

test("a check that can't run ends the loop instead of rerolling blind", async () => {
  const provider = fakeProvider([]);
  const critic = fakeCritic([{ status: "skipped", reason: "rate limited" }]);
  const events = await collect(runOutfit(request, { provider, critic, maxAttempts: 3 }));
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(events.at(-1), { type: "done", best: 1, attempts: 1 });
});

test("a failed redo keeps the earlier picture and warns", async () => {
  const provider = fakeProvider([undefined, new ProviderError("rate limited")]);
  const critic = fakeCritic([fail(4)]);
  const events = await collect(runOutfit(request, { provider, critic, maxAttempts: 3 }));
  assert.deepEqual(events.map((e) => e.type), ["generating", "image", "checking", "review", "generating", "warning", "done"]);
  assert.match(events.at(-2).message, /rate limited/);
  assert.deepEqual(events.at(-1), { type: "done", best: 1, attempts: 1 });
});

test("a failure before any picture exists is thrown", async () => {
  const provider = fakeProvider([new ProviderError("bad key")]);
  await assert.rejects(collect(runOutfit(request, { provider, maxAttempts: 2 })), /bad key/);
});

test("pickBest prefers a pass, then the top score, then the later attempt", () => {
  assert.equal(pickBest([{ attempt: 1, review: fail(9) }, { attempt: 2, review: pass(7) }]), 2);
  assert.equal(pickBest([{ attempt: 1, review: fail(5) }, { attempt: 2, review: fail(5) }]), 2);
  assert.equal(pickBest([{ attempt: 1, review: fail(7) }, { attempt: 2, review: fail(5) }]), 1);
  assert.equal(pickBest([{ attempt: 1, review: null }]), 1);
});
