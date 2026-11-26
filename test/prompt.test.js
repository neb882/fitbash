import test from "node:test";
import assert from "node:assert/strict";

import { buildPrompt, STYLES, CHOICES, choiceApplies } from "../public/lib/prompt.js";

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

test("who wears the outfit and their build are said only when chosen, and only where there is a body", () => {
  // Left alone, the model picks a man or a woman, and a build, as it sees fit.
  const ask = (style, chosen = {}) => buildPrompt({ items, style, fillGaps: true, ...chosen });
  assert.match(ask("model", { wearer: "woman" }), /standing front on against a plain light background\. The model is a woman\.\n/);
  assert.match(ask("model", { wearer: "man" }), /The model is a man\./);
  assert.match(ask("mannequin", { wearer: "woman" }), /plain light studio background\. The mannequin has a woman's figure\.\n/);
  assert.match(ask("mannequin", { wearer: "man" }), /The mannequin has a man's figure\./);
  assert.match(ask("model", { build: "slim" }), /background\. The model has a slim build\.\n/);
  assert.match(ask("model", { wearer: "man", build: "plus" }), /background\. The model is a man\. The model is plus-size\.\n/);
  assert.match(ask("mannequin", { wearer: "woman", build: "average" }), /woman's figure\. The mannequin has an average build\.\n/);

  const unsaid = /is a (wo)?man|(wo)?man's figure|build|plus-size|street|park/;
  for (const style of ["model", "mannequin"]) {
    for (const nothing of [{}, { wearer: "", build: "", place: "" }, { wearer: "robot", build: "giant", place: "moon" }]) {
      assert.doesNotMatch(ask(style, nothing), unsaid);
      assert.ok(ask(style, nothing).includes(`${STYLES[style].scene}\n`));
    }
  }
  // A flat lay has nobody in it and no setting, whatever was chosen for the other looks.
  for (const style of ["flatlay", "hologram"]) {
    assert.doesNotMatch(ask(style, { wearer: "woman", build: "plus", place: "street" }), unsaid);
  }
});

test("a setting takes the place of the plain backdrop, for a person only", () => {
  const ask = (style, place) => buildPrompt({ items, style, place, fillGaps: true });
  const street = ask("model", "street");
  assert.match(street, /head-to-toe photo, standing front on in a city street in daylight, the street softly out of focus so the clothes stay the subject\.\n/);
  assert.doesNotMatch(street, /plain light background|studio/);
  assert.match(ask("model", "outdoors"), /standing front on outdoors in a park in daylight/);
  // A shop mannequin stays in the studio.
  assert.ok(ask("mannequin", "street").includes(`${STYLES.mannequin.scene}\n`));
});

test("every choice starts with saying nothing, and is offered only where it has words", () => {
  assert.deepEqual(CHOICES.map((choice) => choice.name), ["wearer", "build", "place"]);
  for (const choice of CHOICES) {
    assert.equal(Object.keys(choice.options)[0], "", choice.name);
    assert.deepEqual(Object.keys(choice.options[""]), ["label"], choice.name);
    assert.equal(choiceApplies(choice, "flatlay"), false, choice.name);
    assert.equal(choiceApplies(choice, "model"), true, choice.name);
  }
  assert.equal(choiceApplies(CHOICES[0], "mannequin"), true);
  assert.equal(choiceApplies(CHOICES[1], "mannequin"), true);
  assert.equal(choiceApplies(CHOICES[2], "mannequin"), false);
  // The scenes proven on the real service are unchanged by being put together from parts.
  assert.equal(STYLES.model.scene, "Show the pieces worn together by a fashion model in a full-length, head-to-toe studio photo, standing front on against a plain light background.");
  assert.equal(STYLES.mannequin.scene, "Dress a plain, faceless shop mannequin in the pieces and show it full length, head to toe, front on, against a plain light studio background.");
});
