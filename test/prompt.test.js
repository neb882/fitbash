import test from "node:test";
import assert from "node:assert/strict";

import { buildPrompt, namedBasics, STYLES, CHOICES, choiceApplies } from "../public/lib/prompt.js";

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
  // Seen with a local model: asked for "a plain one", it gave a lone shirt shorts with separate lower legs.
  assert.match(filled, /add it: plain full-length trousers, or a plain pair of ordinary shoes, in a neutral color/);
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
  // Seen with eight pieces once they were kept apart: jeans turned over with a leg folded, a tee folded short.
  assert.match(STYLES.flatlay.scene, /whole, front side up, laid out straight and at its true length and proportions: none cropped, shortened, folded or turned over\./);
  // Seen again with eight pieces, and with boots: a jacket over the tee, shoes on the jeans' hems.
  assert.match(STYLES.flatlay.scene, /shoes beside the lower legs of the bottoms\./);
  assert.match(STYLES.flatlay.scene, /bare background around every piece, shoes and outer layers included, so that no piece touches or covers any part of another/);
});

test("a person in a reference picture lends the item and nothing else", () => {
  // Seen with the real service: a shirt given as a mirror selfie came back on a model with that man's face and hair.
  for (const style of Object.keys(STYLES)) {
    assert.match(buildPrompt({ items, style, fillGaps: true }), /take the item only: never copy that person's face, hair, body or pose\./);
  }
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

test("basics are offered only for what the named pieces leave open", () => {
  const ask = (labels, style = "flatlay", fillGaps = true) => buildPrompt({ items: labels.map((label) => ({ label })), style, fillGaps });
  const whole = /cannot be complete without a piece that is missing \(bottoms or shoes\), add it: plain full-length trousers, or a plain pair of ordinary shoes/;

  // Nothing says what the pieces are: the instruction is as it was.
  assert.match(ask(["grey shirt"]), whole);
  assert.match(ask(["", ""]), whole);

  // Bottoms and shoes both named: there is nothing to add, so the model is told exactly what it is told
  // with the box unticked. Measured on the local models: with the sentence 5 flat lays of 6 gained
  // trousers or shoes nobody supplied, without it 0 of 10.
  for (const style of ["flatlay", "mannequin", "model"]) {
    const named = ["grey shirt", "tie dye jeans", "oversized clown shoes"];
    assert.equal(ask(named, style), ask(named, style, false), style);
    assert.doesNotMatch(ask(named, style), /add it|add them/, style);
  }

  // Only shoes can be missing: trousers are not offered, and are ruled out.
  const noShoes = ask(["grey shirt", "tie dye jeans"]);
  assert.match(noShoes, /If the outfit has no shoes, add them: a plain pair of ordinary shoes, in a neutral color/);
  assert.match(noShoes, /Add nothing beyond that: no other bottoms, hats, bags/);
  assert.doesNotMatch(noShoes, /full-length trousers/);

  // Only bottoms can be missing.
  const noBottoms = ask(["grey shirt", "clown shoes"]);
  assert.match(noBottoms, /If the outfit has no bottoms, add them: plain full-length trousers, in a neutral color/);
  assert.match(noBottoms, /Add nothing beyond that: no other shoes, hats, bags/);
  assert.doesNotMatch(noBottoms, /pair of ordinary shoes/);
});

test("a piece's name says whether it is bottoms or shoes, without being fooled by look-alike words", () => {
  const is = (label) => namedBasics([label]);
  for (const label of ["blue jeans", "Bootcut Jeans", "boot cut jeans", "sweatpants", "dress pants", "midi skirt", "sundress", "linen shorts", "denim overalls"]) {
    assert.deepEqual(is(label), { bottoms: true, shoes: false }, label);
  }
  for (const label of ["red and white sneakers", "dress shoes", "Chelsea Boots", "ankle boots", "oversized clown shoes", "leather loafers", "flip-flops"]) {
    assert.deepEqual(is(label), { bottoms: false, shoes: true }, label);
  }
  for (const label of ["dress shirt", "short sleeve shirt", "flat cap", "shoelaces", "frog tee", "blue fedora hat", "", undefined]) {
    assert.deepEqual(is(label), { bottoms: false, shoes: false }, String(label));
  }
  assert.deepEqual(namedBasics(["frog tee", "blue jeans", "sneakers"]), { bottoms: true, shoes: true });
});
