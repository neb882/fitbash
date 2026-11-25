# Testing against the real services

Everything else in `test/` uses stand-ins. This folder is for the other kind of test: the real page, a real key, real pictures of clothes, and a person (or a session) looking at what comes back. It is the only way to learn whether a connection works and how well a model keeps a garment's print, colour and cut.

It costs money on the key's account: about 4 cents a picture on Google's suggested model, more on some others.

## What is and isn't proven so far

Written 2026-11-25; change this list as runs are made.

- Proven against the real services, with deliberately wrong keys: the key checks for Google, OpenAI and OpenRouter, and the page's handling of Google's "key not valid" answer to a picture request.
- Proven with a real Google key that had no billing (2026-11-25): the key check passes, the picture request reaches the service in a form it accepts, and its refusal ("limit: 0 ... on Free Tier", HTTP 429) is shown as the page's billing advice. No picture was made and nothing was spent.
- Proven with the same key once billing was on (2026-11-25): ten real pictures from `gemini-nano-banana-2.1`, six of them outfits made through the page by the runner. Google's answer is read correctly (a `thought` step, then a `model_output` step holding the picture as JPEG). Prints, lettering, colours and details were kept in every outfit. Two faults in the instruction were found and fixed (accessories nobody supplied; jeans shortened in a square flat lay), and both cases were run again and came out right. The main README, "Which models, and why", has the account.
- Proven with the owner's own run on shop photos and ten more pictures (2026-11-25): Google's model turned an unusually shaped piece into the ordinary version of it. Oversized clown shoes came out as ordinary-sized sneakers, and enormous wide-leg jeans as merely baggy ones; naming the piece helped only partly. A sentence in the instruction asking for each piece's own shape and proportions fixed all three cases, held on a second try, and left an ordinary outfit unchanged.
- Partly proven with the real Lemonade app on the owner's computer (2026-11-25, Windows, a 12 GB NVIDIA card, `Flux-2-Klein-4B`): the page recognised the card, connected from the website, listed the model and reported Setup as ready. A picture from three pieces failed with HTTP 500 and only "sd-server request failed" as its message. Lemonade's source shows the picture engine's own reason travelling in `error.details.response`; the page now reads it, and a second real try (five pieces) showed it on the page: "generate_image returned no results", which is what the engine says when it fails without a reason of its own. That answer is pinned in `test/local.test.js`. The cause is still to be found; the engine's log (`lemonade logs`) is where it would be.
- Not yet proven: a picture from OpenAI or OpenRouter; the OpenRouter sign-in round trip; the Claude check; a picture from a model on a visitor's own computer; the download readout against the real app (`/v1/pull` as a job, `/v1/downloads`); photos of the owner's own clothes (a hanger, a person, a cluttered background).

## Before a run

1. **The key.** It never goes in chat, a file or a command line. It is saved as a network secret on the session's environment, and the workspace's network then attaches it to requests to that host while the runner types a placeholder into Setup.
   - OpenAI (`api.openai.com`) and OpenRouter (`openrouter.ai`) read `Authorization: Bearer`, which the secure credential form can save.
   - Google (`generativelanguage.googleapis.com`) reads `x-goog-api-key` with no prefix, which the form cannot save and Google does not accept as `Bearer` (checked 2026-11-25). The owner adds it in the environment's settings under Network secrets. The `fitbash` environment has one saved; `curl` to `/v1beta/models` with any placeholder key answering 200 shows it is attached.
   - A key in an environment variable works too: name the variable with `--key-env`.
   - Google makes pictures only for a key with billing turned on. On the free tier every image model answers "limit: 0".
   - A script run with Node reaches the network directly unless `NODE_USE_ENV_PROXY=1` is set, and so goes without the key. The browser the runner drives needs nothing extra.
2. **The pieces.** The best test is the owner's own clothes: ask for photos, a graphic or lettered tee among them, since prints are where these models fail. Put each outfit in its own folder under `test/real/pieces/`, one picture per piece, named for the piece:

   ```
   test/real/pieces/
     weekend/   01-frog-tee.jpg   02-blue-jeans.jpg   03-white-sneakers.jpg
     one-shirt/ 01-striped-shirt.jpg
   ```

   The file name becomes the piece's name on the page (`01-frog-tee.jpg` is "frog tee"). Git ignores this folder. If the owner has no photos to hand, use freely licensed product photos and say where they came from; on 2026-11-25 Wikimedia Commons and Openverse both refused this workspace's searches as too frequent.
3. **The budget.** Outfits times looks is the number of pictures (double it if the check is on and a redo happens). Tell the owner the number first. The runner stops at 8 pictures unless `--max-pictures` says otherwise.

## The run

```sh
npm ci
node test/real/run.mjs --pieces test/real/pieces                      # Google, flat lay and on a model
node test/real/run.mjs --pieces test/real/pieces --looks flatlay      # one look only
node test/real/run.mjs --pieces test/real/pieces --service openrouter --model openai/gpt-image-2.5-sunburst
node test/real/run.mjs --pieces test/real/pieces --site https://<owner>.github.io/fitbash/   # the published site
```

It opens the page, connects the key in Setup, and for each outfit adds the pictures, names them, picks the look and presses **Make the outfit**. Into `test/real/out/` go every picture made, a `report.md`, and for each run an `…-answers.json` holding what the services answered, with pictures and other long text cut short.

To have the Claude check take part, give its key the same way (`--check-key-env`). From this kind of workspace the browser may not reach Anthropic's address at all (a certificate error, seen 2026-11-25); that is the workspace's network, not the site.

## Reading the results

Open each picture beside the pieces it was made from and, for every piece, answer:

- Is it there, once?
- Is the colour right? The cut?
- Is a print, logo or lettering the same artwork and the same words, or a redrawn lookalike?

Then for the picture as a whole: anything added that wasn't asked for, anything distorted, any caption or border. Report to the owner one line per outfit and look, with the picture, and say plainly which pieces came out wrong. A run where every request succeeded can still be a failed test.

## When a run fails

- **The page's message** is in the runner's output and in `report.md`. It should say what to do; if it doesn't, that is a finding too.
- **`…-answers.json`** shows the status and the shape of each answer. A connection written from documentation can differ from the real service in a field name or in how an answer is wrapped: fix the code in `public/lib/providers/` to match what the service really sent, add a unit test that holds that shape, and run again.
- **A message about billing, credit or verification** is the account, not the code: the owner has to turn billing on (Google), add credit (OpenRouter, OpenAI) or verify (OpenAI).
- **`net::ERR_CERT_…` among the failures** is this workspace's network standing between the browser and the service.

## Afterwards

- Change "What is and isn't proven so far" above, and the sentences in the main README that say a connection has not been run for real.
- If models were compared, put what was found in the README under "Which models, and why", as a result this time.
- Remind the owner to delete the key and to remove it from the environment's saved secrets.
