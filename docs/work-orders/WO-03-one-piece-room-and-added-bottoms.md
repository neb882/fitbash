# WO-03 Room for a one-piece outfit, and the bottoms added to a lone top

For the worker on the owner's computer. Read `docs/PROGRESS.json` (G1 and G7) first. This follows your WO-02:
part D there is the failure part A here tries to cure, and its last section is the fault part B counts.

## Decides

1. **G1, the options Setup's line saves.** For a one-piece outfit the engine puts the whole model on the card
   as one block and then needs 2.47 GB of working room, so it fails when another program holds half a gigabyte
   more than usual. If one of the engine's own options makes it split the model for one piece as it does for
   two (or otherwise leave itself room), and outfits of several pieces still work at about the same speed,
   Setup's line gains that option. If none does, the line stays and the page keeps its advice to close other
   programs.
2. **G7, the instruction's sentence about added pieces.** It now names them: "plain full-length trousers, or a
   plain pair of ordinary shoes". If the standard model still gives a lone top malformed bottoms about as
   often as before (4 in 11), the sentence changes again or the fault is recorded as the model's.

## Do

**A. Room for one piece** (the checkout, after `git merge origin/main`; `Flux-2-Klein-4B`; one piece, the grey
shirt; options loaded with `save_options: false`).

1. Read the engine's own help (`sd-server.exe --help`) for anything that limits what it puts on the card or
   forces it to split the model: a memory budget (`--max-vram` in newer builds), a segment or graph-cut
   setting, a parameter backend (`--params-backend`), anything of that kind. Copy the lines you rely on into
   the report. Lemonade refuses some options it manages itself; if it refuses one, say so and move on.
2. Choose up to three candidate option sets, each `--diffusion-fa --offload-to-cpu` plus one such option at a
   value you can justify from the help text and from the figures in WO-02 (the weights are 7392 MB, the
   working room 2470 MB, the card 12200 MB).
3. For each candidate: five one-piece runs with 1024 MiB held by your holder from WO-02, started fresh before
   every run. Read the engine's plan from its log (how many segments, what it staged, its `reported free` and
   `need`).
4. For any candidate that made at least four of the five: two one-piece runs with nothing held, and two
   three-piece and two four-piece runs with nothing held, for the seconds against WO-01's table.
5. If no candidate made four of five, stop part A there.

**B. Bottoms for a lone top** (the published site, once its version is no longer `7c2b35e2c910`: wait as in
WO-02 if it still is; the owner's saved options; look "on a model").

Eight one-piece pictures from `Flux-2-Klein-4B`: the grey shirt four times and the lettered tee four times.
Then four from `Flux-2-Klein-9B-GGUF`: the grey shirt twice, the lettered tee twice. Open every one.

## Measure

A: per run: options, in use before the holder and just before the run, made or failed, seconds, segments,
and on a failure the engine's `reported free` and `need`. For step 4, seconds and peak memory.
B: per picture: what was added below the top (trousers, shorts, a skirt, something malformed: say what), the
shoes added, and anything else nobody supplied.

## Budget

About 45 pictures and 40 minutes of the card's time. No download.

## Leave as found

Both models with their saved options (`--diffusion-fa --offload-to-cpu`), `Flux-2-Klein-4B` loaded. Nothing
saved by this order: every candidate is loaded with `save_options: false`. Your holder closed. Do not run
LM Studio's tools again; its background service from WO-02 is the owner's to close.

## Done when

- The help lines you relied on are in the report, and each candidate has five held runs, or the report says
  why it could not be run.
- A candidate that made four of five has its six further runs.
- B has twelve pictures, each described.

## Report

`docs/reports/WO-03.md` on the branch `gpu-findings`, merged up from `main` first. One section per part, then
Verified / Not verified, surprises, and the state the computer was left in. `npm test` before pushing. When it
is pushed, send one line with its commit.
