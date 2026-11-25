# fitbash

Outfit maker: item pictures in, one generated outfit picture out. It is a static site in `public/` that GitHub Pages serves as-is; all generation runs in the browser with the user's own API keys. `server.js` is an optional local helper that adds product-link lookup. README.md has the layout.

## Commands

```sh
npm ci
npm test               # unit tests, a few seconds
npm run test:browser   # the page in a real browser against stand-in services
npm run test:all       # both; what CI runs
npm start              # the page with the local helper, on http://localhost:3000
```

Where the installed Chromium is not the one Playwright pins, set `CHROMIUM_EXECUTABLE` to its path for the browser tests. No test needs a key or reaches outside the machine.

## Checks

- `npm run test:all` passes before every commit.
- **CI is the inspection.** Every push runs the `tests` workflow on a clean runner; a push to `main` runs the same tests and publishes the site only if they pass. After a push, read the run on the head commit yourself (its conclusion and its head SHA). [A local pass says nothing about a fresh checkout, and the site is public the moment a deploy finishes.]
- Every fix comes with a test that fails without it. A change to what a visitor sees or does gets a browser test in `test/browser/`.
- Check a new test by breaking the code it covers: the break must fail it. [A test that cannot fail reads as coverage and protects nothing.]
- Report results with the command's output, not a summary of it.

## Rules

Most rules give their reason in brackets, so a rule can be dropped once its reason no longer holds.

- Never commit names, emails, usernames, chat screenshots, real photos of people, API keys or `.env` files. Test fixtures are synthetic. [The repository is public and its history keeps everything.]
- No names or identifiers of the AI assistant models that build this project in code, docs or commit messages, apart from the attribution trailer the session's instructions require on each commit. The models the page itself calls (the image models, the check) are named wherever needed.
- Everything under `public/` runs in a browser from a subfolder: relative URLs only, no Node APIs, no build step, no front-end framework. [GitHub Pages serves the folder as it is, under `/<repository>/`.]
- API keys live only in the user's browser storage and go only to their own provider. No analytics, third-party scripts or CDN imports, and `connect-src` in `public/index.html` lists only the providers the page calls, plus the visitor's own computer (`localhost` and `127.0.0.1`) for a local model. [A visitor's key is their money; the content security policy is what keeps a mistake from sending it elsewhere.]
- What a visitor makes stays on their device: past outfits and their item pictures are kept in the browser's own storage (`public/lib/history.js`) and never uploaded. The page must keep working where the browser refuses storage. [People put photos of their own clothes, and sometimes of themselves, into the page.]
- The content security policy forbids inline scripts and styles.
- The look is paper, ink and one warm accent, with Instrument Serif (in `public/fonts/`, with its licence) for headings and the system font for everything else. Colours are the variables at the top of `public/style.css`, each defined for light and dark; a new colour pair must pass the accessibility test in both.
- The people using the page are not technical. Text on the page says what to do in everyday words ("key", "service", "picture"), every error says what to do next, and anything optional or advanced stays out of the main path.
- Claude calls use the official `@anthropic-ai/sdk`. The browser loads it from `public/vendor/anthropic-sdk.js`, which is generated: change the version in `package.json` and run `npm run vendor`, never edit the file.
- Every user-supplied URL the server fetches goes through `src/safe-fetch.js`, never a direct `fetch`. The server listens on 127.0.0.1 unless `HOST` says otherwise. [It fetches whatever address it is given, which must not reach private networks or be offered to a whole network.]
- The generate-check-redo loop in `public/lib/pipeline.js` always has a hard attempt cap, and a failed check never costs the person a picture that already exists. [Each attempt is the visitor's money.]
- Image API shapes change often. Before editing `public/lib/providers/gemini.js`, `openai.js`, `openrouter.js` or `local.js`, read the provider's current documentation instead of relying on memory, and confirm with a CORS preflight that browsers may send any header you add. [Both had changed since the code was first drafted, and one documented header is refused from browsers.]
- A browser test's stand-in must fail the way the real thing fails. [The test harness lets a page read a cross-site refusal that a real browser hides, so a stand-in that simply answered 403 exercised a path no visitor would take.]
- The site's version is stamped at deploy by `scripts/stamp-version.sh` (a fingerprint of `public/`), never by hand, and a stamped file is never committed: `public/sw.js` and `public/index.html` say `dev` in the repository. [The fingerprint changes exactly when a file a visitor loads changes, so there is no number to forget; a test holds the repository's copy to `dev`.]
- The page never reloads itself. A newer version is announced and the visitor chooses when. [The pieces a visitor has added live only in the open page.]
- `public/sw.js` serves the site's own files network-first and touches nothing else, and only a stamped copy registers it. Change it with care and read the live site after the deploy: a broken service worker stays in visitors' browsers until a fixed one replaces it.
- GitHub Actions versions are looked up, not remembered (`git ls-remote --tags https://github.com/actions/<name>`). [The first deploy failed on an upload step two major versions behind its deploy step.]

## Testing against the real services

`test/real/README.md` is the procedure, and `test/real/run.mjs` does the run: it uses the page in a browser as a visitor would and saves every picture with what the service answered. Read the procedure before the first run of a session.

- It spends the owner's money. Say how many pictures a run will make before starting it, and keep to the runner's limit.
- A key reaches a session only through the secure credential form, never through chat, a file, a command line or a commit.
- Photos of real clothes and the pictures made from them stay in `test/real/pieces/` and `test/real/out/`, which git ignores. [They are the owner's, and may show people.]
- What the real service answered outranks its documentation: when they differ, fix the code to the answer and pin it in a unit test. [The first real request showed Google wrapping its errors in a list, which no page read had said.]

## Which model does what

The split is by the kind of work, as in the owner's other projects. The model is chosen when an agent is started and is never written into this repository.

- **A smaller model for facts:** reading a documentation page, looking up a version, a CORS preflight, a browser run-through against written steps. It reports what it saw, with sources, and decides nothing. Use the smallest model for a single page and the middle one when several pages have to be reconciled.
- **The middle model where a test can say whether the work is right:** a change whose checks are written down before it starts.
- **The strongest model where judgment is the only check:** what to build, anything touching `src/safe-fetch.js`, the content security policy or how keys are handled, and the last read of a diff before it reaches `main`.
- The main session does the work itself unless it is one of the above and can run alongside. fitbash is small: don't add builder, reviewer and skeptic roles until a change needs several work orders at once.
- **The check inside the page is a judgment role too:** nothing checks its verdict, and a missed print defect is the failure it exists to catch. Cut its cost with smaller inputs first (it already gets 1024-pixel references). Change its default model or effort only after comparing the candidates on real outfit pictures with known defects.

## Usage

`.claude/mods/usage-meter/` is a Claude Code mod that shows the plan's 5-hour and weekly usage and gives the session a tool, `mcp__usage-meter__usage`. Its README says how to install it in a new session.

- Read the meter before starting agents, a workflow or any other heavy run, and size the work to what is left.
- Never draw on usage credits. [They are the owner's money.]
- Work that changes nothing a visitor sees and decides nothing is not worth the usage.
