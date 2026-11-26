# WO-07 The basics sentence, narrowed by the pieces' names

For the worker on the owner's computer. Read `docs/PROGRESS.json` (G9) first. Everything here uses the
**published site** once its version is no longer `15c0fa8c736b`, with `--computer medium` and each model's
saved options, the box "Add plain basics for anything missing" **ticked** (the page's default, so no
`--no-basics`). Nothing on the computer changes.

## What changed

The page now reads the pieces' names (`namedBasics` in `public/lib/prompt.js`):

- Bottoms and shoes both named (as in "tie dye jeans" and "oversized clown shoes"): the sentence about adding
  a missing piece is left out, and the instruction says what it says with the box unticked. That is the
  instruction of your WO-06 part A, so those ten pictures already stand for it.
- Only bottoms named: "If the outfit has no shoes, add them: a plain pair of ordinary shoes, … Add nothing
  beyond that: no other bottoms, hats, bags, …".
- Only shoes named: the same for bottoms.
- Neither named: the sentence as before.

## Decides

G9, round 2, and its last question. In WO-06 part C, with only shoes missing, the old sentence drew plain
trousers under the supplied jeans in 1 picture of 2 and two pairs of shoes in 1 of 2. If the narrowed sentence
adds shoes and no trousers, G9 closes with the overlap recorded as the models' limit. If it still draws
trousers, the report says so and G9 closes all the same, with that recorded: no third wording will be tried.

## Do

Look "flat lay", named pieces, `Flux-2-Klein-9B-GGUF` unless said otherwise.

**A. Only shoes missing.** The grey shirt and the tie dye jeans: four pictures.

**B. Both named, the box ticked.** The three-piece outfit (grey shirt, tie dye jeans, oversized clown shoes):
one picture on `Flux-2-Klein-9B-GGUF` and one on `Flux-2-Klein-4B`. These two are for the engine's log more
than for the picture.

Read from the engine's log: in A, that the instruction has "If the outfit has no shoes, add them" and no
"full-length trousers"; in B, that it has "Show only the supplied items" and no sentence about adding.

## Measure

A, per picture: shoes added (yes or no; one pair or more); **trousers or any other bottoms nobody supplied
(yes or no)**; anything else added. B: the two log readings, and whether anything nobody supplied is in the
picture. Seconds for each. The overlap of shirt and jeans need not be judged again.

## Budget

6 pictures and about 6 minutes of the card's time. No download.

## Leave as found

Both models' saved options as they are, the standard model loaded.

## Done when

A has four pictures with the three answers each, and B has its two log readings.

## Report

`docs/reports/WO-07.md` on the branch `gpu-findings`, merged up from `main` first. `npm test` before pushing.
The orchestrator watches the branch, so the push is enough.
