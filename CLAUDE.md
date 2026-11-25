# fitbash

Outfit maker: item pictures in, one generated outfit picture out. It is a static site in `public/` that GitHub Pages serves as-is; all generation runs in the browser with the user's own API keys. `server.js` is an optional local helper that adds product-link lookup. See README.md for the layout.

## Checks

- `npm test` must pass before every commit. Tests need no keys and no network.
- For changes to `public/`, also load the page in a browser and run through add, generate and result, both from a plain static file server under a subfolder (how Pages serves it) and from `npm start`. With no key set the page uses the mock image model.
- Report results with the command output, not a summary of it.

## Rules

- This repository is public-facing. Never commit names, emails, usernames, chat screenshots, real photos of people, API keys or `.env` files. Test fixtures are synthetic.
- Everything under `public/` must run in a browser from a subfolder: relative URLs only, no Node APIs, no build step, no front-end framework. The server test enforces the first two.
- API keys live only in the user's browser storage and go only to their own provider. Don't add analytics, third-party scripts or CDN imports, and keep `connect-src` in `public/index.html` limited to the providers the page actually calls.
- The content security policy forbids inline scripts and styles.
- Claude calls use the official `@anthropic-ai/sdk`. The browser loads it from `public/vendor/anthropic-sdk.js`, which is generated: change the version in `package.json` and run `npm run vendor`, never edit the file.
- Every user-supplied URL the server fetches goes through `src/safe-fetch.js`. Don't call `fetch` on one directly. The server listens on 127.0.0.1 unless `HOST` says otherwise.
- The generate-check-redo loop in `public/lib/pipeline.js` must always have a hard attempt cap, and a failed check must never cost the person a picture that already exists.
- Image API shapes change often. Before editing `public/lib/providers/gemini.js` or `openai.js`, read the provider's current documentation instead of relying on memory, and confirm with a CORS preflight that browsers may send any header you add.
