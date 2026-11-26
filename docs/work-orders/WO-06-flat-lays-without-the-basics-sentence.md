# WO-06 Flat lays on the local models: without the basics sentence, and with a note

For the worker on the owner's computer. Read `docs/PROGRESS.json` (G9) and your own `docs/reports/WO-05.md`,
part B, first. Everything here uses the **published site** once its version is no longer `90a590fbeb3f`, with
`--computer medium` and each model's saved options. Nothing on the computer changes.

The tracked runner has one new option: `--no-basics` unticks "Add plain basics for anything missing", which
takes the sentence about adding bottoms or shoes out of the instruction. Merge `main` into `gpu-findings`
before you start, to have it.

## Decides

G9, round 1. None of six flat lays was clean in WO-05, and your guess was that the sentence about adding
missing bottoms or shoes draws the extra trousers and shoes.

1. If flat lays **without that sentence** have nothing nobody supplied, the page will leave the sentence out
   of a flat lay on a local model whenever it cannot apply, and part C says whether it still does its job
   when it can.
2. If pieces still lie on each other, part B says whether **a note** about gaps cures it. If it does, the
   page's flat lay sentence gains a variant for local models; if not, the tip the page now shows with a flat
   lay on a local model ("On a model keeps your pieces best") stays as the answer and no more is spent.

## Do

All with the look "flat lay", named pieces, the pieces of WO-05.

**A. Without the basics sentence** (`--no-basics`). `Flux-2-Klein-9B-GGUF`: the three-piece outfit (grey
shirt, tie-dye jeans, clown shoes) twice and the four-piece outfit with the hat twice. `Flux-2-Klein-4B`: the
three-piece outfit twice. Six pictures.

**B. Without the basics sentence, with a note** (`--no-basics --notes "Leave a clear gap of bare background
between every piece. No piece touches or lies on another. Draw each piece once, and nothing else."`).
`Flux-2-Klein-9B-GGUF`: the three-piece outfit twice. `Flux-2-Klein-4B`: the three-piece outfit twice. Four
pictures.

**C. Where the basics sentence is wanted** (the box ticked, as the page has it by default).
`Flux-2-Klein-9B-GGUF`: the grey shirt and the tie-dye jeans, no shoes supplied, twice; the grey shirt alone
twice. Four pictures.

Read from the engine's log, once for A and once for C, that the sentence beginning "If the outfit cannot be
complete without a piece that is missing" is absent in A and present in C.

## Measure

Per picture, WO-05's five answers (every piece there once; whole; front side up; unfolded; clear of the
others; background plain), and separately: **what is in the picture that nobody supplied** (trousers, shoes,
a second pair, anything else). For C: were the missing pieces added, once each, plain, and clear of the
supplied ones. Seconds for each.

## Budget

14 pictures and about 15 minutes of the card's time. No download.

## Leave as found

Both models' saved options as they are (`--diffusion-fa --offload-to-cpu --max-vram 8` for the standard
model, `--diffusion-fa --offload-to-cpu` for the larger), the standard model loaded.

## Done when

- A has six pictures, B four and C four, each with its answers.
- The report's first section says, for A against WO-05's part B, how many of six have something nobody
  supplied and how many have a piece lying on another; and the same two counts for B's four.

## Report

`docs/reports/WO-06.md` on the branch `gpu-findings`, merged up from `main` first. `npm test` before pushing.
When it is pushed, send one line with its commit (the orchestrator also watches the branch).
