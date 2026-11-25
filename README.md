# fitbash

An outfit maker. Paste pictures of clothing items and get one generated picture of the pieces together as an outfit. It isn't tied to any store or brand, so you can try a shirt you already own against a cheap jacket you found online before buying anything.

It is a static web page: everything runs in your browser, using your own account with an AI image service. There are two ways to open it.

## Use it as a website (GitHub Pages)

The page lives in `public/` and needs no server, so GitHub Pages can host it for free.

1. In the repository on GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push to `main`, or run the **Deploy to GitHub Pages** workflow by hand from the **Actions** tab.

The site appears at `https://<your-username>.github.io/<repository>/`. Everyone who uses it connects their own account (see setup below), so hosting it costs you nothing and nobody can spend your credit.

## Run it on your computer

Needs Node 22 or newer. Nothing to install.

```bash
npm start
```

Open http://localhost:3000. Running it locally adds one feature the website can't have: paste a link to a product page and fitbash finds the item's picture for you. A browser isn't allowed to read other sites' pages, so that part needs the small local server.

## First-time setup (a few minutes, once)

The page walks you through this in its **Setup** box:

1. Pick a service: Google Gemini, OpenAI, or OpenRouter. With OpenRouter there is nothing to copy: press **Connect OpenRouter**, sign in there and approve, and you come back with the key filled in.
2. Press the button to open that service's key page, sign in, and create a key. A key is a long code that works like a password and lets fitbash make pictures on your account.
3. Paste the key into the page. It tells you straight away whether the key works.

After that you just add pictures and press **Make the outfit**. Before setup is finished the page still works, but gives you a plain collage of your pieces instead of a real outfit picture.

Things worth knowing before you start:

- **Pictures cost money**, usually a few cents each, billed by the service to your own account. Both services want a payment method on file before they make pictures.
- **Google** needs billing turned on for the key. **OpenAI** needs prepaid credit and an identity check, which takes longer. **OpenRouter** needs some credit added to the account. If any of these is missing, the page tells you which.
- **OpenRouter is one account for many models.** It sells access to image models from Google, OpenAI, Microsoft, Black Forest Labs and others, and Setup lets you choose among them from a short list. The page suggests Google's Nano Banana 2.1 there, the cheapest of the leading ones.
- Services rename their models now and then. If pictures stop working with a message about an unknown model, the current name goes under **Advanced** in Setup. The defaults are `gemini-nano-banana-2.1` and `gpt-image-2.5-sunburst`.

The Gemini, OpenAI and OpenRouter connections were written from the services' documentation and are covered by tests that pin the documented request and response shapes. They have not yet been run against the live services, so expect to fix a detail or two on first use.

## Free alternative: a model on your own computer

If your computer has a good graphics card, it can make the pictures itself, at no cost. In Setup choose **This computer** and follow its three steps:

1. Say what kind of computer it is. The page often recognises the graphics card and suggests an answer; it cannot read how much memory the card has, so check the suggestion.
2. Install [Lemonade](https://lemonade-server.ai), a free app that runs AI models locally, and open it.
3. Press **Connect**. The page finds the app, offers the model that suits your computer, and can start the download for you (the standard model is about 16 GB).

Things worth knowing:

- **It needs Chrome, Edge or Firefox.** They ask once whether this site may reach apps on your device; choose Allow. Safari does not permit it, so it does not work on iPhones or iPads either.
- **On the website, the app has to be told to accept it,** once, with one line pasted into a terminal. The page shows the exact line when it is needed. Running fitbash locally (`npm start`) needs no such step.
- **Speed depends on the graphics card.** A recent card makes a picture in seconds to a minute; without one it can take many minutes, and a paid service is the practical choice.
- **Local models are less exact** than the paid services, most of all on prints and lettering. The quality check below still works with a local model, and still costs its few cents.
- Any app that offers the same interface works: put its address under **Advanced** in Setup (for example `http://127.0.0.1:1234/v1` for stable-diffusion.cpp's server, started with this site in its `--cors-origins`).

This path was written from Lemonade's documentation and is tested against a stand-in for the app. It has not yet been run against the real app on real hardware, so expect to fix a detail or two on first use.

## Which models, and why

The defaults were chosen from public rankings and the services' own documentation (read in November 2026). They have not yet been compared side by side on real clothes, which is the test that matters; treat this as the reasoning, not a result.

- **OpenAI `gpt-image-2.5-sunburst`.** In the top four of the Artificial Analysis image-editing ranking, and reported to lead the Arena ranking for edits from several pictures. `gpt-image-2.6-sunburst` ranks slightly higher and costs more per picture; put its name under **Advanced** in Setup to use it.
- **Google `gemini-nano-banana-2.1`.** About tenth in the same ranking, but it takes the most reference pictures (14, per Google) and costs about 4 cents a picture, the least of the leaders.
- **All of them are weakest where it matters most here.** A published test of earlier versions of these models on 850 products found a product's details kept only about 28% of the time, with distorted logos and lettering the commonest fault. That is why the quality check exists.
- **On your own computer**, Lemonade can run two models that combine several pictures on a Windows PC with an NVIDIA card or on a Mac: `Flux-2-Klein-4B`, which the page suggests, and `Flux-2-Klein-9B-GGUF`, which it suggests for graphics cards with 20 GB or more. The larger one ranks higher among open models (1012 against 940 on Artificial Analysis) and is licensed for non-commercial use only. When a model does not fit in the graphics card's memory, the app spills over into ordinary memory: it still works, more slowly.
- **Better open models exist than Lemonade can run on those computers:** FLUX.3 Image Klein (1068 in that ranking, and said by its maker to fit 8 GB cards) and Qwen-Image 2.1 (1082). stable-diffusion.cpp's own server runs both; someone comfortable setting that up can point fitbash at it under **Advanced**.
- **Through OpenRouter** the same two are offered, along with others that rank well and have not been tried here: Microsoft's MAI-Image-2.7 (top of the Artificial Analysis ranking, but five pieces at most), FLUX 3 Image, Seedream 5.5 and Google's dearer Nano Banana Pro. That makes OpenRouter the easy place to compare models on your own clothes.
- **Not yet looked at closely:** Kling Image 4.0 and the services built for trying clothes on.

## The quality check

Image models often return a polished picture that has quietly changed what matters: a graphic tee's print redrawn, a color shifted, a piece left out. If you also add a Claude key under **Optional: double-check every picture** in Setup, every generated picture goes to Claude along with your item pictures. Claude reports per item whether it is present and true to its picture. When something is off, fitbash regenerates once with Claude's notes, shows both attempts with their verdicts, and marks the better one.

Each check is one Claude request. On the default model it costs roughly 3 to 7 cents for a three-piece outfit, about as much as the picture itself, and a redo means a second picture and a second check. That is an estimate from token prices, not a measurement. Without a Claude key you get a single unchecked picture.

The check sees your item pictures at 1024 pixels, which is more detail than the generated outfit shows of any one piece. A cheaper Claude model can be entered under **Advanced** in Setup; it will cost less and may miss more of the subtle changes the check is there to catch.

## Adding items

- Paste a picture from the clipboard anywhere on the page.
- Drop picture files on the Pieces box, or use **Add pictures**.
- Paste a link. On the website this works for links that point straight at a picture, when the picture's host allows it. Run locally, it also works for product pages on many shops, including most Shopify stores.

Large retailers often block automated visits, in which case the page says so. Copying the product picture and pasting it always works.

An outfit takes up to 8 pieces. Pictures are shrunk to 1536 pixels on the long side before they go to the image service.

## Past outfits

Each outfit picture you make is kept under **Past outfits** at the bottom of the page, newest first, so you can compare combinations side by side. For each one you can:

- open it larger,
- download it,
- press **Use these pieces** to put its items and look back into the page, swap one, and make it again,
- remove it, or remove them all.

The page keeps the newest 24 and drops older ones. They are stored in your browser only, together with the item pictures that made them, and never sent anywhere. Clearing the site's data in your browser removes them, and a private window keeps nothing.

## When a newer version is out

If the site is updated while you have it open, a bar appears at the top: "A newer version of fitbash is out." Press **Reload** to get it, or **Later** to finish what you're doing first. The page never reloads by itself, because the pieces you have added exist only in the open page; your past outfits and your keys are kept either way.

Opening the site always gives you the newest version. It also keeps a copy of itself in your browser, so the page still opens without a connection (making pictures needs one, unless the model runs on your own computer).

If you run fitbash from your own copy with `npm start`, there is no notice: update it the way you got it, for example with `git pull`.

## Your keys and pictures

- Keys are saved in your browser's local storage and nowhere else. **Forget my keys** in Setup removes them.
- Requests go straight from your browser to the provider the key belongs to. The page's content security policy lets it send requests only to itself, Google, OpenAI, OpenRouter, Anthropic and an app on your own computer, and run only its own scripts. The one other thing it can reach is a picture at a link you paste, which it loads the way any page loads an image.
- fitbash has no server of its own that stores anything: no accounts, no database, no analytics. Past outfits stay in your browser. Your item pictures go to the image provider you chose, and to Anthropic if the quality check is on, under those providers' terms. With a model on your own computer and the check off, they go nowhere.
- A key kept in a browser can be read by anyone with access to that browser profile. Use keys with a spending limit, and don't save them on a shared computer.

## How it is put together

```
public/                      the whole app; this folder is what GitHub Pages serves
  index.html, style.css, app.js
  lib/pipeline.js            generate, check, redo loop with the attempt cap
  lib/prompt.js              the instruction sent to the image model, and the three looks
  lib/critic.js              the Claude check (structured verdict per item)
  lib/keycheck.js            tells a person whether a pasted key works, at no cost
  lib/providers/             gemini, openai, openrouter, local and mock image models behind one generate() call
  lib/openrouter-connect.js  signing in at OpenRouter to receive a key, instead of pasting one
  lib/hardware.js            guesses the graphics card's size tier, to suggest a local model
  lib/history.js             past outfits, kept in the browser's own storage
  lib/update.js              notices that a newer version of the site is out
  sw.js                      service worker: always-fresh files, an offline copy, and the site's version
  vendor/anthropic-sdk.js    browser build of the official Anthropic SDK (generated, see below)
  fonts/                     the heading typeface, Instrument Serif, served from this site (SIL Open Font License, in OFL.txt)
server.js                    optional local server: serves public/ and adds link lookup
src/extract.js               product link to candidate pictures
src/safe-fetch.js            fetching pasted links without reaching private networks
test/                        unit tests for all of the above
test/browser/                the page driven in a real browser
.github/workflows/test.yml   runs every test on each push
.github/workflows/pages.yml  runs the tests, stamps the version, then publishes public/ to GitHub Pages
scripts/stamp-version.sh     writes a fingerprint of the site's files into the page and the service worker
```

There is no build step. The one generated file is `public/vendor/anthropic-sdk.js`, a single-file browser copy of `@anthropic-ai/sdk` that is committed so the static site can load it. After changing the SDK version in `package.json`, run `npm install && npm run vendor` to rebuild it.

To add another image model, write a module in `public/lib/providers/` that exports a factory returning `{ name, model, generate({ prompt, images, aspectRatio }) }` and resolves to `{ mimeType, data }` (base64). Register it in `public/lib/providers/index.js`, and add its API host to `connect-src` in `public/index.html` (an app on the visitor's own computer is already covered). The provider's API has to accept requests from browsers (CORS).

## Tests

```bash
npm ci
npm test               # unit tests
npm run test:browser   # the page in a real browser (first run: npx playwright install chromium)
npm run test:all       # both
```

The browser tests open the page the way GitHub Pages serves it and use it as a visitor would: first-time setup, pasting keys, adding pictures, making an outfit, the check and its redo, a model on the visitor's own computer, past outfits, and a phone-sized screen. They also run an automated accessibility check (contrast, labels, roles) in the light and dark colours. The three AI services are replaced by canned answers, so the tests need no keys and reach nothing outside your machine.

Every push runs all of them on GitHub. A push to `main` publishes the site only if they pass.

## Ideas for later

- Try the outfit on a photo of yourself.
- Suggest pieces that would complete the outfit, with links.
- Share an outfit with someone else.
