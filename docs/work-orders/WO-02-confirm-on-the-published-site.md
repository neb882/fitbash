# WO-02 Confirm the changes on the published site, and settle the one-piece question

For the worker on the owner's computer. Read `docs/PIPELINE.md` and `docs/PROGRESS.json` first, and
`docs/reports/WO-01.md` section 2 for the one-piece failure this order follows up.

The page changed after WO-01 (what changed is under each part below). Parts A to C use the **published site**,
`https://neb882.github.io/fitbash/`, not the checkout: `node test/real/run.mjs --service local --site
https://neb882.github.io/fitbash/ ...`. Before you start, check the page's version is no longer `2dfcab85a112`
(`<meta name="fitbash-version">`); if it still is, the change has not been published yet, so wait five minutes
and look again, and stop and say so if it has not changed after twenty. If Lemonade refuses the published site
(Setup shows the "allow this website" steps), stop and report that instead of changing the app's setting.

## Decides

1. **G2 and G1, the step in Setup.** Whether Setup shows the one more step for a model that has no
   `--diffusion-fa` saved, on any kind of computer, and puts it away once it is saved. If either fails on the
   real app, the page's check of `recipe_options.sdcpp_args` changes.
2. **G6, a new picture each time.** The page now sends a seed of its own with every request. If two requests
   for the same outfit still give the same file, the seed is not reaching the engine and the page changes.
3. **G1, which line.** Setup's line saves `--diffusion-fa --offload-to-cpu`. If, with part of the card held by
   something else, a one-piece outfit fails clearly more often with both options than with `--diffusion-fa`
   alone, the line becomes `--diffusion-fa` alone. If the two fail alike, the line stays and the page's advice
   to close other programs is the answer.
4. **The failure message.** It now says to close other programs that use the card instead of "fewer pieces".
   If what the page shows is not what is written under part D, the page changes.

## Do

**A. The step in Setup** (published site, a real browser window or the runner's, either is fine).
1. Choose "This computer", press Connect. With `Flux-2-Klein-4B` chosen (the owner's saved options are in
   place) the step must not be shown.
2. Choose `Flux-2-Klein-9B-GGUF` (downloaded in WO-01, no saved options). The step must be shown, with the
   line `lemonade load Flux-2-Klein-9B-GGUF --sdcpp-args "--diffusion-fa --offload-to-cpu" --save-options`.
   Change the answer to "What kind of computer is this?" through all five choices: the step stays.
3. Run that line exactly as shown, in a terminal. Press Connect. The step must go.
4. With the larger model still chosen, make a one-piece and a three-piece outfit.

**B. A new picture each time** (published site). `Flux-2-Klein-4B`, one three-piece outfit, made three times
without changing anything. Compare the three files byte for byte, and look at them.

**C. The failure message** (published site). Load `Flux-2-Klein-4B` with no options and `save_options: false`
(as you did in WO-01), make a two-piece outfit, and copy what the page says, whole. Then load the owner's saved
options back.

**D. The one-piece question** (the checkout is fine here). Hold about 1 GB more of the card than was in use
in WO-01's table, by a means that installs nothing: for example a small chat model loaded in Lemonade beside
the picture model (a download of up to 1 GB is allowed for this), or anything already on the computer that
holds graphics memory steadily. Say what you used and what `nvidia-smi` showed in use just before each run.
Then, `Flux-2-Klein-4B`, one piece, five runs with `--diffusion-fa` alone and five with both options, loaded
with `save_options: false`. If neither fails, hold about 0.5 GB more and repeat once.

## Measure

A: shown or not at each step, the line's exact text, and for the two pictures made or failed, seconds.
B: the three files' sizes and hashes, and whether the pictures differ to the eye.
C: the page's message, whole.
D: per run: options, card memory in use by other programs just before, made or failed, seconds, and the
engine's `reported free` and `need` figures on a failure.

## Budget

About 25 pictures and 40 minutes of the card's time. One download of up to 1 GB, only for part D.

## Leave as found

`Flux-2-Klein-4B` loaded with the owner's saved options (`--diffusion-fa --offload-to-cpu`), which stay saved.
Anything loaded or started for part D unloaded or closed; a model downloaded for part D may stay, named in the
report. **One thing this order changes on purpose:** part A saves `--diffusion-fa --offload-to-cpu` for
`Flux-2-Klein-9B-GGUF`. Leave it saved (the model cannot make an outfit without it) and say so in the report.

## Done when

- Each step of A has an answer, with the line's text copied from the page.
- B has three hashes.
- C has the message.
- D has ten runs at one level of held memory, or twenty at two, each with the memory figure.

## Report

`docs/reports/WO-02.md` on the branch `gpu-findings`, merged up from `main` first (`git merge origin/main`,
no rebase). One section per part, then Verified / Not verified, surprises, and the state the computer was left
in. Run `npm test` before pushing. When it is pushed, send one line with its commit.
