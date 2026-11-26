# WO-01 The local model on a 12 GB card: baseline

For the worker on the owner's computer. Read `CLAUDE.md`, `docs/PIPELINE.md` and
`test/real/README.md` ("A model on the owner's own computer") first. Most of this was already under way when
the order was written: use what you have measured, and run only what is missing.

## Decides

1. **G1.** The line Setup shows to someone whose card is smaller than the model. Today it is
   `lemonade load <model> --sdcpp-args "--diffusion-fa --offload-to-cpu" --save-options`. If one option alone
   is as reliable, the page will show that one. If neither is needed, the step goes.
2. **G2.** How Setup learns the step is done. Today it looks for `--offload-to-cpu` in
   `recipe_options.sdcpp_args` of each entry of `GET /v1/models?show_all=true`. The page will read whichever
   field really holds the saved options.
3. **G3.** Whether the download readout is right. If the page's size, speed or time left disagree with the
   app's own window by more than a difference of units, the page changes.
4. **G4.** What the page promises about pieces. Today it stops at four. If pieces are lost at three or four,
   Setup and the README will say so, or the cap comes down.
5. **G5.** Whether to keep suggesting `Flux-2-Klein-9B-GGUF` for cards of 20 GB or more, and whether a 12 GB
   card can run it at all.

## Do

Through the page, with `test/real/run.mjs --service local`, `Flux-2-Klein-4B`, the look "model":

- Each of: no options, `--diffusion-fa` alone, `--offload-to-cpu` alone, both. For each, outfits of 1, 2, 3 and
  4 pieces, each outfit twice. Reload the model between option sets and confirm from the app which options it
  is running with.
- After `--save-options`, save the entry for the model from `GET /v1/models?show_all=true` and from
  `GET /v1/health`.
- One download started from Setup, with the page's readout written down beside the app's own figures a few
  times along the way.
- If `Flux-2-Klein-9B-GGUF` is downloaded: 1 and 3 pieces with the option set that did best, twice each.

## Measure

Per run: pieces, options, made or failed, seconds, peak card memory in MiB, and the engine's own words on a
failure. Per picture: for every piece, kept faithfully, changed (how), or missing.

## Budget

About 45 pictures. One download of up to 20 GB (the larger model). An hour of the card's time.

## Leave as found

The model's saved options as the owner had them: `--diffusion-fa --offload-to-cpu`, saved. Lemonade's log level
back to what it was. Nothing running that was not running before.

## Done when

- Every cell of the options-by-pieces table has two runs, or says why it could not be run.
- The report names the field and value that show saved options, copied from a real answer.
- The download comparison has at least three points.
- Every picture counted as made has been opened and described.

## Report

`docs/reports/WO-01.md` on the branch `gpu-findings`, as `docs/PIPELINE.md` describes, with:

1. The table: options × pieces → made/failed (n of n), seconds, peak MiB.
2. The engine's log lines that explain any failure, cut to the lines that matter.
3. The saved-options field, with the JSON around it.
4. Readout against the app's window, point by point, with units.
5. Pieces kept, changed and missing, per outfit.
6. The larger model's runs, if made.
7. Verified / Not verified, and the state the computer was left in.
8. Where each fetched test piece came from, with its licence.
