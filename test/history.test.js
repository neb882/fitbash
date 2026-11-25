import test from "node:test";
import assert from "node:assert/strict";

import { MAX_OUTFITS, describePieces, idsToDrop } from "../public/lib/history.js";

// The storing itself needs a browser and is covered in test/browser/.

test("only the newest outfits are kept", () => {
  assert.deepEqual(idsToDrop([1, 2, 3], 3), []);
  assert.deepEqual(idsToDrop([5, 1, 4, 2, 3], 3), [1, 2]);
  assert.deepEqual(idsToDrop([], 3), []);
  const full = Array.from({ length: MAX_OUTFITS + 1 }, (_, i) => i + 10);
  assert.deepEqual(idsToDrop(full), [10]);
});

test("a past outfit is described by its named pieces, or by how many there were", () => {
  assert.equal(describePieces(["frog tee", "blue jeans"]), "frog tee, blue jeans");
  assert.equal(describePieces(["frog tee", " ", ""]), "frog tee and 2 more");
  assert.equal(describePieces(["", ""]), "2 pieces");
  assert.equal(describePieces([""]), "1 piece");
});
