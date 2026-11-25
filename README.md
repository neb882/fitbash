# fitbash

An outfit maker. Paste pictures of clothing items and get one generated picture of the pieces together as an outfit. It isn't tied to any store or brand, so you can try a shirt you already own against a cheap jacket you found online before buying anything.

It is a static web page: everything runs in your browser, with your own API key for the image model. There are two ways to use it.

## Use it as a website (GitHub Pages)

The page lives in `public/` and needs no server, so GitHub Pages can host it for free.

1. In the repository on GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push to `main`, or run the **Deploy to GitHub Pages** workflow by hand from the **Actions** tab.

The site appears at `https://<your-username>.github.io/<repository>/`. Everyone who uses it enters their own API key (see below), so hosting it costs you nothing and nobody can spend your credit.

## Run it on your computer

Needs Node 22 or newer. Nothing to install.

```bash
npm start
```

Open http://localhost:3000. Running it locally adds one feature the website can't have: paste a link to a product page and fitbash finds the item's picture for you. A browser isn't allowed to read other sites' pages, so that part needs the small local server.

## Choosing an image model

Out of the box the page uses a stand-in that tiles your pictures into a plain collage, so you can try it before paying for anything. For real outfit pictures, open **Settings** on the page, choose an image model and paste your API key:

| Image model | Where to get a key | Default model |
| --- | --- | --- |
| Google Gemini | https://aistudio.google.com/apikey | `gemini-nano-banana-2.1` |
| OpenAI | https://platform.openai.com/api-keys | `gpt-image-2.5-sunburst` |

Both take several reference pictures in one request and charge per picture, usually a few cents. Check the provider's pricing page for current numbers. The model name can be changed in Settings when the providers release new ones.

The Gemini and OpenAI adapters were written from the providers' documentation and are covered by tests that pin the documented request and response shapes. They have not yet been run against the live APIs, so expect to fix a detail or two on first use.

## The quality check

Image models often return a polished picture that has quietly changed what matters: a graphic tee's print redrawn, a color shifted, a piece left out. If you also add a Claude API key in Settings, every generated picture goes to Claude along with your item pictures. Claude reports per item whether it is present and true to its picture. When something is off, fitbash regenerates once with Claude's notes, shows both attempts with their verdicts, and marks the better one.

Each check is one Claude request, which adds about a cent or two per picture on the default model. Without a Claude key you get a single unchecked picture.

## Adding items

- Paste a picture from the clipboard anywhere on the page.
- Drop picture files on the Pieces box, or use **Add pictures**.
- Paste a link. On the website this works for links that point straight at a picture, when the picture's host allows it. Run locally, it also works for product pages on many shops, including most Shopify stores.

Large retailers often block automated visits, in which case the page says so. Copying the product picture and pasting it always works.

An outfit takes up to 8 pieces. Pictures are shrunk to 1536 pixels on the long side before they are sent.

## Your keys and pictures

- API keys are saved in your browser's local storage and nowhere else. **Forget saved keys** in Settings removes them.
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
