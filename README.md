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
- Requests go straight from your browser to the provider the key belongs to. The page's content security policy allows it to contact only itself, Google, OpenAI and Anthropic, and to run only its own scripts.
- Nothing is stored by fitbash: no accounts, no database, no analytics. Your item pictures go to the image provider you chose, and to Anthropic if the quality check is on, under those providers' terms.
- A key kept in a browser can be read by anyone with access to that browser profile. Use keys with a spending limit, and don't save them on a shared computer.

## How it is put together

```
public/                      the whole app; this folder is what GitHub Pages serves
  index.html, style.css, app.js
  lib/pipeline.js            generate, check, redo loop with the attempt cap
  lib/prompt.js              the instruction sent to the image model, and the three looks
  lib/critic.js              the Claude check (structured verdict per item)
  lib/keycheck.js            tells a person whether a pasted key works, at no cost
  lib/providers/             gemini, openai and mock image models behind one generate() call
  vendor/anthropic-sdk.js    browser build of the official Anthropic SDK (generated, see below)
server.js                    optional local server: serves public/ and adds link lookup
src/extract.js               product link to candidate pictures
src/safe-fetch.js            fetching pasted links without reaching private networks
test/                        node --test suites for all of the above
.github/workflows/pages.yml  publishes public/ to GitHub Pages
```

There is no build step. The one generated file is `public/vendor/anthropic-sdk.js`, a single-file browser copy of `@anthropic-ai/sdk` that is committed so the static site can load it. After changing the SDK version in `package.json`, run `npm install && npm run vendor` to rebuild it.

To add another image model, write a module in `public/lib/providers/` that exports a factory returning `{ name, model, generate({ prompt, images, aspectRatio }) }` and resolves to `{ mimeType, data }` (base64). Register it in `public/lib/providers/index.js`, and add its API host to `connect-src` in `public/index.html`. The provider's API has to accept requests from browsers (CORS).

## Tests

```bash
npm install
npm test
```

The tests use local servers and stand-in models. They need no API keys and make no outside requests.

## Ideas for later

- Try the outfit on a photo of yourself.
- Suggest pieces that would complete the outfit, with links.
- Save and share outfits.
