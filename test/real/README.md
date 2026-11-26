# Testing against the real services

Everything else in `test/` uses stand-ins. This folder is for the other kind of test: the real page, a real key, real pictures of clothes, and a person (or a session) looking at what comes back. It is the only way to learn whether a connection works and how well a model keeps a garment's print, colour and cut.

It costs money on the key's account: about 4 cents a picture on Google's suggested model, more on some others.

## What is and isn't proven so far

Written 2026-11-25; change this list as runs are made.

- Proven against the real services, with deliberately wrong keys: the key checks for Google, OpenAI and OpenRouter, and the page's handling of Google's "key not valid" answer to a picture request.
- Proven with a real Google key that had no billing (2026-11-25): the key check passes, the picture request reaches the service in a form it accepts, and its refusal ("limit: 0 ... on Free Tier", HTTP 429) is shown as the page's billing advice. No picture was made and nothing was spent.
- Proven with the same key once billing was on (2026-11-25): ten real pictures from `gemini-nano-banana-2.1`, six of them outfits made through the page by the runner. Google's answer is read correctly (a `thought` step, then a `model_output` step holding the picture as JPEG). Prints, lettering, colours and details were kept in every outfit. Two faults in the instruction were found and fixed (accessories nobody supplied; jeans shortened in a square flat lay), and both cases were run again and came out right. The main README, "Which models, and why", has the account.
- Proven with the owner's own run on shop photos and ten more pictures (2026-11-25): Google's model turned an unusually shaped piece into the ordinary version of it. Oversized clown shoes came out as ordinary-sized sneakers, and enormous wide-leg jeans as merely baggy ones; naming the piece helped only partly. A sentence in the instruction asking for each piece's own shape and proportions fixed all three cases, held on a second try, and left an ordinary outfit unchanged.
- Partly proven with the real Lemonade app on the owner's computer (2026-11-25, Windows, a 12 GB NVIDIA card, `Flux-2-Klein-4B`): the page recognised the card, connected from the website, listed the model and reported Setup as ready. A picture from three pieces failed with HTTP 500 and only "sd-server request failed" as its message. Lemonade's source shows the picture engine's own reason travelling in `error.details.response`; the page now reads it, and a second real try (five pieces) showed it on the page: "generate_image returned no results", which is what the engine says when it fails without a reason of its own. That answer is pinned in `test/local.test.js`. The engine's own output reaches Lemonade's log only when the log level was Debug at the moment the engine started. The cause was memory: the model's files total about 16 GB against the card's 12, and the failures stopped once the owner ran `lemonade load Flux-2-Klein-4B --sdcpp-args "--diffusion-fa --offload-to-cpu" --save-options`. Setup showed that line for cards of up to 16 GB at first; the measurements below made it every card.
- Proven with the real Lemonade app, later the same day: a first picture from a model on the owner's computer, made through the published site from five shop photos. The shirt and the tie-dye jeans were kept well; the hat and the pendant were left out; the shoes became sandals. FLUX.2 klein takes up to four reference pictures by its maker's documentation, so the page now refuses a fifth piece for it instead of letting pieces vanish.
- Proven with the real Lemonade app by a session on the owner's computer (2026-11-25, the same 12 GB card, 68 picture requests; `docs/reports/WO-01.md` has every number and the engine's own words): of the memory step's two options it is `--diffusion-fa` that the card needs. Without it `Flux-2-Klein-4B` made one-piece outfits and failed every outfit of two, three or four pieces (14 of 14), with or without `--offload-to-cpu`. With it, alone or beside the other option, every outfit of two to four pieces was made (20 of 20), in 19 to 53 seconds. With both options a one-piece outfit failed 3 times in 6, each time while other programs held about 2 GB of the card: for a single piece the engine puts the whole model on the card at once and is then short of working room. "Try again with fewer pieces" is the wrong advice for that failure.
- Proven in the same session: the app lists the saved options as `recipe_options.sdcpp_args` in `/v1/models?show_all=true`, exactly as typed, and leaves the key out for a model nobody has saved options for. `/v1/health` shows the options the engine is running with now, which can differ from the saved ones.
- Proven in the same session: the download readout against the app's own window, on a 19.3 GB download started from Setup (`/v1/pull` answered as a job). Size, speed, percent and time left agreed at three points once units are accounted for: the window counts in 1024s and labels the result GB and MB/s, the page counts in decimal GB and megabits a second. Between two files the app reports no progress for about half a minute, and the readout then shows the size alone.
- Proven in the same session: local pictures from one to four pieces, read piece by piece, 18 different pictures from two models. No piece was missing from any of them. The smaller model redrew lettering with wrong letters; `Flux-2-Klein-9B-GGUF` kept the words. Neither kept oversized clown shoes oversized, both shifted a hat's colour, and both added jewellery nobody supplied to most outfits of several pieces. The larger model ran on the 12 GB card with `--diffusion-fa` and failed without it, and took about one and a half times as long. The app uses the same seed every time, so the same pieces gave the same picture; the page has since sent a seed of its own with each request.
- Proven on the published site against the real app (2026-11-26, `docs/reports/WO-02.md`): Setup's one more step is hidden for a model with `--diffusion-fa` saved, shown for one without under every kind of computer, and gone once its line has been run; three requests for one outfit give three different pictures; a failed local picture shows the new advice. Measured in the same session: with half a gigabyte or one gigabyte of the card held by another program, a one-piece outfit failed 18 times in 20, alike under `--diffusion-fa` alone and under both options, and was made every time with nothing held. And when the standard model adds bottoms to a lone top, 4 pictures in 11 had shorts with separate lower legs.
- Not yet proven: a picture from OpenAI or OpenRouter; the OpenRouter sign-in round trip; the Claude check; whether an engine option can keep a one-piece outfit from failing when the card is partly in use (WO-03); any card that is not 12 GB, and a Mac; a local picture in a look other than "on a model"; a download that is interrupted; photos of the owner's own clothes taken at home (a hanger, a person, a cluttered background; one fetched shop photo of a shirt on a hanger came out well).

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
node test/real/run.mjs --pieces test/real/pieces --site https://<owner>.github.io/fitbash/   # the published site (with --service local the runner answers the browser's "may this site reach apps on your device" itself)
```

It opens the page, connects the key in Setup, and for each outfit adds the pictures, names them, picks the look and presses **Make the outfit**. Into `test/real/out/` go every picture made, a `report.md`, and for each run an `…-answers.json` holding what the services answered, with pictures and other long text cut short.

To have the Claude check take part, give its key the same way (`--check-key-env`). From this kind of workspace the browser may not reach Anthropic's address at all (a certificate error, seen 2026-11-25); that is the workspace's network, not the site.

## A model on the owner's own computer

This needs a session that runs on that computer (the graphics card is there), with Lemonade open and the model downloaded. A cloud session cannot reach it. When that session works alongside the cloud session that builds the page, `docs/PIPELINE.md` says how, and its jobs come as work orders in `docs/work-orders/`.

```sh
npm ci                              # or, where there is bun and no npm: bun install --no-save
npx playwright install chromium
node test/real/run.mjs --service local --pieces test/real/pieces --looks model --wait-minutes 15
```

The runner serves this checkout on the computer itself, which Lemonade accepts without being told to. It costs nothing but time. What is worth finding out, one change at a time, with the seconds each picture took:

- One, two, three and four pieces: which pieces are kept, and where it starts to lose them.
- With and without the memory step above, and with `--diffusion-fa` alone or `--offload-to-cpu` alone: which of the two a card smaller than the model really needs, and what each costs in time.
- Whether `/v1/models?show_all=true` shows the saved options under `recipe_options` once the step is done.
- The larger model (`--model Flux-2-Klein-9B-GGUF`), if there is room to download it: whether it keeps prints and odd shapes better.
- A download started from Setup: whether the readout's size, speed and time left match what Lemonade's own window shows.

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
