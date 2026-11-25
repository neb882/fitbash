# fitbash

Outfit maker: item pictures or links in, one generated outfit picture out. See README.md for the layout.

## Checks

- `npm test` must pass before every commit. Tests need no keys and no network.
- For changes to `public/`, also load the page in a browser and run through add, generate and result. `npm start` with no `.env` uses the mock image model.
- Report results with the command output, not a summary of it.

## Rules

- This repository is public-facing. Never commit names, emails, usernames, chat screenshots, real photos of people, API keys or `.env` files. Test fixtures are synthetic.
- Keys come from environment variables only and must never reach the browser. `/api/config` has a test for this.
- Every user-supplied URL goes through `src/safe-fetch.js`. Don't call `fetch` on one directly.
- The generate-check-redo loop in `src/pipeline.js` must always have a hard attempt cap, and a failed check must never cost the person a picture that already exists.
- Image API shapes change often. Before editing `src/providers/gemini.js` or `src/providers/openai.js`, read the provider's current documentation instead of relying on memory.
- No build step and no front-end framework in `public/`. The content security policy forbids inline scripts and styles.
- Claude calls use the official `@anthropic-ai/sdk`.
