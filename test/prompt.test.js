import test from "node:test";
import assert from "node:assert/strict";

import { buildPrompt, STYLES, WEARERS } from "../public/lib/prompt.js";

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

test("an unusual shape is to be kept, not turned into the ordinary version", () => {
  // Seen with the real service: oversized clown shoes came out as ordinary-sized checkered sneakers,
  // and enormous wide-leg jeans as merely baggy ones.
  for (const style of Object.keys(STYLES)) {
    const prompt = buildPrompt({ items, style, fillGaps: true });
    assert.match(prompt, /shape and proportions as well, however unusual/);
    assert.match(prompt, /never slim it down, shorten it or turn it into the ordinary version/);
  }
});

test("who wears the outfit is said only when chosen, and only where there is a body", () => {
  // Left alone, the model picks a man or a woman as it sees fit.
  const ask = (style, wearer) => buildPrompt({ items, style, wearer, fillGaps: true });
  assert.match(ask("model", "woman"), /standing front on against a plain light background\. The model is a woman\.\n/);
  assert.match(ask("model", "man"), /The model is a man\./);
  assert.match(ask("mannequin", "woman"), /plain light studio background\. The mannequin has a woman's figure\.\n/);
  assert.match(ask("mannequin", "man"), /The mannequin has a man's figure\./);

  const unsaid = /is a (wo)?man|(wo)?man's figure/;
  for (const style of ["model", "mannequin"]) {
    assert.doesNotMatch(ask(style, ""), unsaid);
    assert.doesNotMatch(ask(style, undefined), unsaid);
    assert.doesNotMatch(ask(style, "robot"), unsaid);
    assert.ok(ask(style, "").includes(`${STYLES[style].scene}\n`));
  }
  // A flat lay has nobody in it, whatever was chosen for the other looks.
  assert.doesNotMatch(ask("flatlay", "woman"), unsaid);
  assert.doesNotMatch(ask("hologram", "man"), unsaid);

  // The page offers "either" first, and every other choice has a sentence for each worn look.
  assert.equal(Object.keys(WEARERS)[0], "");
  for (const [id, wearer] of Object.entries(WEARERS)) {
    if (!id) continue;
    for (const [style, look] of Object.entries(STYLES)) assert.equal(typeof wearer[style], look.worn ? "string" : "undefined", `${id} ${style}`);
  }
});
