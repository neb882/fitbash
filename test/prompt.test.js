import test from "node:test";
import assert from "node:assert/strict";

import { buildPrompt, STYLES } from "../public/lib/prompt.js";

const items = [{ label: "frog tee" }, { label: "  " }, {}];

test("items are listed in order, with a stand-in for unnamed ones", () => {
  const prompt = buildPrompt({ items, style: "flatlay", fillGaps: false });
  assert.match(prompt, /1\. frog tee\n2\. clothing item\n3\. clothing item/);
  assert.ok(prompt.includes(STYLES.flatlay.scene));
});

test("fill-gaps and worn styles change the rule about extra pieces", () => {
  const strictFlat = buildPrompt({ items, style: "flatlay", fillGaps: false });
  const strictWorn = buildPrompt({ items, style: "model", fillGaps: false });
  const filled = buildPrompt({ items, style: "model", fillGaps: true });
  assert.match(strictFlat, /Show only the supplied items/);
  assert.match(strictWorn, /fully dressed/);
  assert.match(filled, /add a plain one/);
  // Seen with the real service: left to itself it dressed a lone tee with a cap and a watch.
  assert.match(filled, /no hats, bags, watches/);
});

test("notes and feedback are included only when given", () => {
  const bare = buildPrompt({ items, style: "flatlay", fillGaps: true });
  assert.doesNotMatch(bare, /Styling notes|earlier attempt/);
  const full = buildPrompt({ items, style: "flatlay", fillGaps: true, notes: " tucked in ", feedback: "Item 1: wrong print" });
  assert.match(full, /Styling notes from the person: tucked in/);
  assert.match(full, /earlier attempt[\s\S]*Item 1: wrong print/);
});

test("an unknown style falls back to the default scene", () => {
  assert.ok(buildPrompt({ items, style: "hologram", fillGaps: true }).includes(STYLES.flatlay.scene));
});

test("a flat lay is upright and asks for every piece whole", () => {
  // Seen with the real service: in a square frame the jeans came out shortened, with the shoes laid on top.
  assert.equal(STYLES.flatlay.aspectRatio, "3:4");
  assert.match(STYLES.flatlay.scene, /whole and at its true length/);
  assert.match(STYLES.flatlay.scene, /lying on top of another/);
});
