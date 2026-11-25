# fitbash

An outfit maker. Paste pictures of clothing items, or links to them in any shop, and get one generated picture of the pieces together as an outfit. It isn't tied to any store or brand, so you can try a shirt you already own against a cheap jacket you found online before buying anything.

## Run it

Needs Node 22 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. With no setup it uses a stand-in "mock" image model that tiles your pictures into a collage, so you can try the page before paying for anything.

## Get real outfit pictures

Copy `.env.example` to `.env` and set a provider and its key:

| `FITBASH_PROVIDER` | Key | Default model |
| --- | --- | --- |
| `gemini` | `GEMINI_API_KEY` | `gemini-nano-banana-2.1` |
| `openai` | `OPENAI_API_KEY` | `gpt-image-2.5-sunburst` |
| `mock` | none | collage, no AI |

Both real providers take several reference pictures in one request and charge per picture, usually a few cents. Check the provider's pricing page for current numbers. `.env.example` lists the other settings (model names, quality).

The Gemini and OpenAI adapters were written from the providers' documentation and are covered by tests that pin the documented request and response shapes. They have not yet been run against the live APIs, so expect to fix a detail or two on first use.

## The quality check

Image models often return a polished picture that has quietly changed what matters: a graphic tee's print redrawn, a color shifted, a piece left out. If you set `ANTHROPIC_API_KEY`, every generated picture goes to Claude along with your item pictures. Claude reports per item whether it is present and true to its picture. When something is off, fitbash regenerates with Claude's notes, up to `FITBASH_MAX_ATTEMPTS` pictures in total (default 2, maximum 4). The page shows every attempt with its verdict and marks the best one.

Each check is one Claude request, which adds about a cent or two per picture on the default model. Without a Claude key the check is off and you get a single picture.

## Adding items

- Paste a picture from the clipboard anywhere on the page.
- Drop picture files on the Pieces box, or use **Add pictures**.
- Paste or type a product link. fitbash reads the page for the product picture and lets you choose when it finds several.

Links work on many shops, including most Shopify stores. Large retailers often block automated visits, in which case the page says so: copy the product picture and paste it instead. Pasting a picture always works.

An outfit takes up to 8 pieces. Pictures are shrunk in the browser to 1536 pixels on the long side before upload.

## Putting it online

It is one Node process with no database, so it runs on any host that runs Node (`npm start`, port from `PORT`).

Set `FITBASH_ACCESS_CODE` first. Without it, anyone who finds the address can generate pictures on your API keys. With it, the page asks for the code and the server refuses API requests that lack it.

## Privacy

Nothing is stored on the server: no accounts, no database, no uploads on disk, no analytics. Item pictures pass through memory on their way to the image provider you configured, and to Anthropic if the quality check is on. Those providers handle them under their own terms. The access code, if you use one, is remembered in the browser's local storage.

## How it is put together

```
server.js              HTTP server: the page, plus /api/config, /api/extract, /api/image, /api/generate
src/pipeline.js        generate, check, redo loop with the attempt cap
src/prompt.js          the instruction sent to the image model, and the three looks
src/critic.js          the Claude check (structured verdict per item)
src/providers/         gemini, openai and mock image models behind one generate() call
src/extract.js         product link to candidate pictures
src/safe-fetch.js      fetching pasted links without reaching private networks
public/                the page: plain HTML, CSS and JavaScript, no build step
test/                  node --test suites for all of the above
```

`/api/generate` answers with one JSON object per line as each step finishes (`generating`, `image`, `checking`, `review`, `done`), which is how the page shows progress during a request that can take a minute or two.

To add another image model, write a module in `src/providers/` that exports a factory returning `{ name, model, generate({ prompt, images, aspectRatio }) }` and resolves to `{ mimeType, data }` (base64), then register it in `src/providers/index.js`.

## Tests

```bash
npm test
```

The tests use local servers and stand-in models. They need no API keys and make no outside requests.

## Ideas for later

- Try the outfit on a photo of yourself.
- Suggest pieces that would complete the outfit, with links.
- Save and share outfits.
