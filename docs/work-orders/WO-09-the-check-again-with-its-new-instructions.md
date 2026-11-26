# WO-09 The check again, with its new instructions

For the cloud session that ran WO-08, while its pictures are still there. If `test/real/out/wo08/set/` or
`checks.json` is gone (the machine was replaced), **stop and say so**: do not make the pictures again.

## What changed

`public/lib/critic.js`, the check's instructions only (the model, the effort and the request are as they
were). Two things now fail a picture even when every garment is drawn correctly: a piece that cannot be seen
whole (folded over on itself, shortened, or cut off by the picture's edge), and, on a person or a mannequin,
a figure that is not in the frame from the top of the head to the shoes. "Folds" is no longer among the
differences that are fine; creases, drape and a hem tucked a little under a waistband are.

## Decides

G10, round 1. If D7 (jeans folded in half) and D10 (head cut off) now fail in both tries, naming the fault,
and the four good pictures still pass in both tries, and the eight faults caught before are still caught, the
instructions stay and G10 closes on everything but the browser's own path. A good picture that now fails is
as important as a fault still missed: G1's tee hem lies a few centimetres under the jeans' waistband, which
is meant to stay a pass. Whatever the result, no third wording is tried without the owner.

## Do

1. `git fetch origin main && git merge origin/main` in your checkout, so that `public/lib/critic.js` is the
   new one. Say which commit you ran on.
2. Run your `check.mjs` over the same fourteen pictures, the same references and names, `fillGaps: true`,
   twice each, into a new file (`checks-2.json`), keeping the first run's file as it is.

## Measure

The same table as WO-08's part C, with one more column: the first run's two verdicts beside the new ones.
For every fail: the line that names the reason. For G1 to G4: anything the check now objects to, quoted, and
whether, looking at the picture, it is right. Tokens in and out and seconds per check, and the total cost.

## Budget

At most 30 checks (28 and 2 spare). No Google pictures. The key rules of WO-08 hold: never print it, write it
or pass it on a command line.

## Done when

The table has two new tries for each of the fourteen pictures.

## Report

`docs/reports/WO-09.md` on the branch `check-findings`, text only, `npm test` before pushing. Three lines
first: are D7 and D10 caught, do the good pictures still pass, is anything caught before now missed. Then the
table, the costs, Verified and Not verified.
