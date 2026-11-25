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

1. Pick a service. Google Gemini is the easier one.
2. Press the button to open that service's key page, sign in, and create a key. A key is a long code that works like a password and lets fitbash make pictures on your account.
3. Paste the key into the page. It tells you straight away whether the key works.

After that you just add pictures and press **Make the outfit**. Before setup is finished the page still works, but gives you a plain collage of your pieces instead of a real outfit picture.

Things worth knowing before you start:

- **Pictures cost money**, usually a few cents each, billed by the service to your own account. Both services want a payment method on file before they make pictures.
- **Google** needs billing turned on for the key. **OpenAI** needs prepaid credit and an identity check, which takes longer. If either is missing, the page tells you which.
- Services rename their models now and then. If pictures stop working with a message about an unknown model, the current name goes under **Advanced** in Setup. The defaults are `gemini-nano-banana-2.1` and `gpt-image-2.5-sunburst`.

The Gemini and OpenAI connections were written from the services' documentation and are covered by tests that pin the documented request and response shapes. They have not yet been run against the live services, so expect to fix a detail or two on first use.

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

## Your keys and pictures

- Keys are saved in your browser's local storage and nowhere else. **Forget my keys** in Setup removes them.
- Requests go straight from your browser to the provider the key belongs to. The page's content security policy allows it to contact only itself, Google, OpenAI, Anthropic and an app on your own computer, and to run only its own scripts.
- Nothing is stored by fitbash: no accounts, no database, no analytics. Your item pictures go to the image provider you chose, and to Anthropic if the quality check is on, under those providers' terms. With a model on your own computer and the check off, they go nowhere.
- A key kept in a browser can be read by anyone with access to that browser profile. Use keys with a spending limit, and don't save them on a shared computer.

## How it is put together

```
public/                      the whole app; this folder is what GitHub Pages serves
  index.html, style.css, app.js
  lib/pipeline.js            generate, check, redo loop with the attempt cap
  lib/prompt.js              the instruction sent to the image model, and the three looks
  lib/critic.js              the Claude check (structured verdict per item)
  lib/keycheck.js            tells a person whether a pasted key works, at no cost
  lib/providers/             gemini, openai, local and mock image models behind one generate() call
  lib/hardware.js            guesses the graphics card's size tier, to suggest a local model
  vendor/anthropic-sdk.js    browser build of the official Anthropic SDK (generated, see below)
server.js                    optional local server: serves public/ and adds link lookup
src/extract.js               product link to candidate pictures
src/safe-fetch.js            fetching pasted links without reaching private networks
test/                        unit tests for all of the above
test/browser/                the page driven in a real browser
.github/workflows/test.yml   runs every test on each push
.github/workflows/pages.yml  runs the tests, then publishes public/ to GitHub Pages
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

The browser tests open the page the way GitHub Pages serves it and use it as a visitor would: first-time setup, pasting keys, adding pictures, making an outfit, the check and its redo, and a phone-sized screen. The three AI services are replaced by canned answers, so the tests need no keys and reach nothing outside your machine.

Every push runs all of them on GitHub. A push to `main` publishes the site only if they pass.

## Ideas for later

- Try the outfit on a photo of yourself.
- Suggest pieces that would complete the outfit, with links.
- Save and share outfits.
