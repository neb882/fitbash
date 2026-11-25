# fitbash

Outfit maker: item pictures in, one generated outfit picture out. It is a static site in `public/` that GitHub Pages serves as-is; all generation runs in the browser with the user's own API keys. `server.js` is an optional local helper that adds product-link lookup. See README.md for the layout.

## Checks

- `npm test` must pass before every commit. Tests need no keys and no network.
- For changes to `public/`, also load the page in a browser and run through add, generate and result, both from a plain static file server under a subfolder (how Pages serves it) and from `npm start`. With no key set the page uses the mock image model.
- Report results with the command output, not a summary of it.

## Rules

- This repository is public-facing. Never commit names, emails, usernames, chat screenshots, real photos of people, API keys or `.env` files. Test fixtures are synthetic.
- No names or identifiers of the AI assistant models that build this project in code, docs or commit messages, apart from the attribution trailer the session's instructions require on each commit. The models the page itself calls (the image models, the check) are named wherever needed.
- Everything under `public/` must run in a browser from a subfolder: relative URLs only, no Node APIs, no build step, no front-end framework. The server test enforces the first two.
- API keys live only in the user's browser storage and go only to their own provider. Don't add analytics, third-party scripts or CDN imports, and keep `connect-src` in `public/index.html` limited to the providers the page actually calls.
- The people using the page are not technical. Text on the page says what to do in everyday words ("key", "service", "picture"), every error says what to do next, and anything optional or advanced stays out of the main path.
- The content security policy forbids inline scripts and styles.
- Claude calls use the official `@anthropic-ai/sdk`. The browser loads it from `public/vendor/anthropic-sdk.js`, which is generated: change the version in `package.json` and run `npm run vendor`, never edit the file.
- Every user-supplied URL the server fetches goes through `src/safe-fetch.js`. Don't call `fetch` on one directly. The server listens on 127.0.0.1 unless `HOST` says otherwise.
- The generate-check-redo loop in `public/lib/pipeline.js` must always have a hard attempt cap, and a failed check must never cost the person a picture that already exists.
- Image API shapes change often. Before editing `public/lib/providers/gemini.js` or `openai.js`, read the provider's current documentation instead of relying on memory, and confirm with a CORS preflight that browsers may send any header you add.

## Which model does what

The split is by the kind of work, as in the owner's other projects. The model is chosen when an agent is started and is never written into this repository.

- **A smaller model for facts:** reading a documentation page, looking up a version, a CORS preflight, a browser run-through against written steps. It reports what it saw, with sources, and decides nothing. Use the smallest model for a single page and the middle one when several pages have to be reconciled.
- **The middle model where a test can say whether the work is right:** a change whose checks are written down before it starts.
- **The strongest model where judgment is the only check:** what to build, anything touching `src/safe-fetch.js`, the content security policy or how keys are handled, and the last read of a diff before it reaches `main`.
- The main session does the work itself unless it is one of the above and can run alongside. fitbash is small: don't add builder, reviewer and skeptic roles until a change needs several work orders at once.
- **The check inside the page is a judgment role too:** nothing checks its verdict, and a missed print defect is the failure it exists to catch. Cut its cost with smaller inputs first (it already gets 1024-pixel references). Change its default model or effort only after comparing the candidates on real outfit pictures with known defects.
