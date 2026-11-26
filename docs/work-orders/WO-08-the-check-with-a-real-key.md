# WO-08 The Claude check with a real key

For a cloud session on the `fitbash` environment, started for this order alone. Read `CLAUDE.md`,
`docs/PIPELINE.md` and `test/real/README.md` first. You are a worker: you measure and report, and you do not
edit `public/`, `src/` or the tests. If the order is unclear or needs a decision it doesn't make, stop and say
so in the report instead of improvising.

## The keys, and what must never happen to them

- The owner's Anthropic key is in the environment variable `FITBASH_TEST_CLAUDE_KEY`. Check that it is there
  with `[ -n "$FITBASH_TEST_CLAUDE_KEY" ]` and nothing else. **Never print it, echo it, put it on a command
  line, write it to a file or a commit, or quote any part of it in the report.** Scripts read it from the
  environment (`process.env`), and the runner takes the variable's *name* (`--check-key-env`).
- Google's key is a network secret: the workspace's network attaches it. The runner types a placeholder into
  Setup, and a Node script needs `NODE_USE_ENV_PROXY=1` to go through that network.
- This spends the owner's money on both. Keep to the budget below; when it is used up, stop and report what
  there is.

## Decides

The page's optional check (`public/lib/critic.js`) has never run with a real key. Nothing checks its verdict,
and a missed fault is the failure it exists to catch.

1. **Does it work from the page at all?** Key accepted in Setup, a picture checked, a verdict shown. If it
   does not, the report's exact error decides the fix.
2. **Does it catch real faults and pass good pictures?** For each kind of fault it misses in both tries, the
   orchestrator will add that kind to the check's instructions; if it fails good pictures, the orchestrator
   will loosen what it is told. If it catches the faults and passes the good ones, the check stays as it is.
3. **What does a check cost and how long does it take?** The page says "roughly doubles the cost of each
   picture". If that is far off, the sentence changes.

## Do

Work in `test/real/out/wo08/` (git ignores it). Helper scripts go there too.

### A. Through the page (decision 1)

```sh
mkdir -p test/real/out/wo08/pieces/example
# the three example pieces, as files the runner can name: 01-frog-tee, 02-blue-jeans, 03-red-and-white-sneakers
# (copy public/examples/frog-tee.webp, blue-jeans.webp, sneakers.webp under those names)
node test/real/run.mjs --pieces test/real/out/wo08/pieces/example --looks model \
  --check-key-env FITBASH_TEST_CLAUDE_KEY --out test/real/out/wo08/page --max-pictures 2
```

Read `report.md` and the `…-answers.json` beside it: what Setup said about the Claude key, whether a request
reached `api.anthropic.com`, its status, the verdict the page showed. A certificate or network error between
the test browser and Anthropic was seen from this kind of workspace once (2026-11-25); if it happens, record
the exact error from the answers file and go on to B, which does not need the browser.

### B. The test set

Good pictures, made through the page with the runner (no check key here), from the example pieces:

- **G1** flat lay, **G2** mannequin, **G3** on a model. One picture each (`--looks flatlay,mannequin,model`).
- **G4** on a model, with odd shoes: first make a piece picture of *oversized clown shoes* (very long, big
  round toes, a loud pattern, plain white background) with the page's own Google provider
  (`createGeminiProvider` in `public/lib/providers/gemini.js`, called from a Node script with any placeholder
  key and `NODE_USE_ENV_PROXY=1`), then make the outfit frog tee, blue jeans, "oversized clown shoes" through
  the page. Open it: the shoes must be clearly oversized. One retry if not.

Faulty pictures, each made by asking the same provider to edit one good picture ("Edit this picture: …
Change nothing else."), one fault per picture:

| | from | the fault to put in |
|---|---|---|
| **D1** | G3 | the tee's lettering reads "STAY HAPPY" instead of "STAY HOPPY" |
| **D2** | G2 | the frog on the tee is replaced by a different cartoon animal, same colours and place |
| **D3** | G3 | the sneakers' laces and toe caps are white instead of red |
| **D4** | G2 | the jeans are black instead of blue |
| **D5** | G3 | the sneakers are replaced by plain brown leather shoes |
| **D6** | G3 | the jeans are cut off above the knee, as shorts |
| **D7** | G1 | the jeans are folded in half, so only the top half shows |
| **D8** | G1 | a second, identical pair of the sneakers lies beside the first |
| **D9** | G4 | the clown shoes are ordinary-sized sneakers with the same pattern |
| **D10** | G3 | no edit: crop the picture's top so the head is cut off at the mouth (any image tool) |

**Open every one at full size before using it.** The fault must be there and plain to see, and nothing else
may have changed (a face that drifted a little is fine; a changed garment is not). One retry per picture if
the edit missed; if it misses twice, drop that row and say so. Write down, per picture, what you see.

### C. The check, run directly (decisions 2 and 3)

A Node script (`NODE_USE_ENV_PROXY=1`) that imports `createCritic` from `public/lib/critic.js` exactly as the
page uses it: the default model, nothing changed. Give it a `client` (the option exists for this) that is the
SDK's own client wrapped only to record each response's `usage`, `model` and the seconds the call took.

- References: the pieces as the page would send them, JPEG, longest side 1024 pixels, with the names typed
  above ("frog tee", "blue jeans", "red and white sneakers"; for G4 and D9 "oversized clown shoes").
- `fillGaps: true`, the page's default.
- Each good picture twice and each faulty picture twice.

Keep every answer whole (verdict, score, the per-item lines, `other_problems`, `fix_instructions`) in a JSON
file beside the pictures.

## Measure

- A: the facts listed there, with the exact error if any.
- C, per picture and try: verdict, score, and **whether the answer names the fault that was put in** (for a
  faulty picture a "fail" for some other reason is not a catch: say what it named instead). For a good
  picture that failed: what it objected to, and whether, looking at the picture again, it was right.
- Per check: input and output tokens as the response reports them, and seconds. The price of the model is
  looked up, not remembered (the `claude-api` skill has current prices); give the cost per check and the
  total, and Google's count of pictures.

## Budget

- Google: at most 22 pictures (2 in A, 5 good and the piece, 9 edits, up to 5 retries).
- Anthropic: at most 34 checks (up to 2 in A, 28 in C, 4 spare for a failed call). If the first three checks
  in C cost more than 50 cents each, stop and report.
- About an hour.

## Done when

- A has its answer, working or not, with the evidence.
- Every row of the test set is either made and described or dropped with the reason.
- C's table has two tries for every picture that was made.

## Report

`docs/reports/WO-08.md`, pushed to the branch `check-findings` (never to `main`). Text only: no pictures, no
key or part of one, no home-folder paths. The first section is three short answers to "Decides". Then A; the
test set with what you saw in each picture; C as a table (picture, the fault put in, try 1, try 2, named the
fault?, tokens in and out, seconds); the costs; **Verified** and **Not verified** kept apart; surprises.
Run `npm test` before pushing (the privacy test reads the report).

Show the owner each picture as it is made, in your own chat. When the report is pushed you are done: say so
in one line and stop.
