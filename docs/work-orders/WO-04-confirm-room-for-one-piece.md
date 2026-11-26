# WO-04 Confirm the room option on the published site

For the worker on the owner's computer. Read `docs/PROGRESS.json` (G1) first. This confirms what your WO-03
found, as a visitor with this card would meet it.

The page changed: for `Flux-2-Klein-4B` when the visitor's computer is "A graphics card with 12 to 16 GB",
Setup's line now saves `--diffusion-fa --offload-to-cpu --max-vram 8`, and someone who has only the first two
saved is shown the step again. Everything here uses the **published site** once its version is no longer
`3bd3e5d52521` (wait as before if it still is). The runner has a new option for the kind of computer, since a
test browser has no graphics card to recognise: `--computer medium`.

## Decides

**G1, closed or not.** If Setup shows the step as written below, the line it shows runs as shown, the step
then goes, and one-piece outfits are made under ordinary use and with a gigabyte held, G1 closes. If any of
these fails on the real app, that part of the page changes and G1 has one round left.

## Do

**A. The step** (published site, the test browser).
1. "This computer", kind of computer "A graphics card with 12 to 16 GB", Connect, `Flux-2-Klein-4B` chosen.
   The owner's saved options for it are `--diffusion-fa --offload-to-cpu`. The step must be shown, reading
   "One more step for this graphics card, done once. Without it a one-piece outfit often fails while other
   programs are using the card:" with the line
   `lemonade load Flux-2-Klein-4B --sdcpp-args "--diffusion-fa --offload-to-cpu --max-vram 8" --save-options`.
2. Change the kind of computer to each of the other four. The step must not be shown for any of them (the
   option was measured on this card only). Back to 12 to 16 GB: shown again.
3. Choose `Flux-2-Klein-9B-GGUF`. The step must not be shown under any kind of computer.
4. `Flux-2-Klein-4B` and 12 to 16 GB again. Run the line exactly as shown, in a terminal. Press Connect. The
   step must go. Copy the model's `recipe_options` from `/v1/models?show_all=true` into the report.

**B. One-piece outfits with the step done** (published site, `--computer medium`, `Flux-2-Klein-4B`, the
grey shirt).
1. Eight requests in one visit with nothing held on purpose, the conditions in which the saved options failed
   5 of 8 in WO-03.
2. Five requests with 1024 MiB held by your holder, started fresh before each.

**C. Several pieces with the step done** (published site): a three-piece and a four-piece outfit, twice each.

## Measure

A: shown or not at each step, the text and the line copied from the page, what the terminal printed.
B and C: per request: in use on the card just before, made or failed, seconds, segments, and the engine's
`reported free` and `need` on any failure. Open the pictures of C and say what became of each piece.

## Budget

About 20 pictures and 20 minutes of the card's time. No download.

## Leave as found

**This order changes one thing on purpose:** part A saves `--diffusion-fa --offload-to-cpu --max-vram 8` for
`Flux-2-Klein-4B`, replacing the owner's `--diffusion-fa --offload-to-cpu`. Leave it saved if part B's
thirteen requests were all made; if two or more failed, put the owner's two options back
(`lemonade load Flux-2-Klein-4B --sdcpp-args "--diffusion-fa --offload-to-cpu" --save-options`) and say so.
The larger model's saved options are not touched. Your holder closed, `Flux-2-Klein-4B` loaded.

## Done when

- Each step of A has an answer, with the page's text copied.
- B has thirteen requests and C four, each with its figures.
- The report says which options are saved for each model at the end.

## Report

`docs/reports/WO-04.md` on the branch `gpu-findings`, merged up from `main` first. `npm test` before pushing.
When it is pushed, send one line with its commit.
