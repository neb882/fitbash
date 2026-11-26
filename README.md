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

A first visit opens with an example, three pictures and the outfit the page made from them, and **Try it with these three** loads those pieces so you can see the whole thing work before finding pictures of your own. A finished outfit has **Save picture**, **Share** where your phone or computer has a share sheet, and **Make another**, since each try comes out a little different. Past outfits are kept below, and one opened large can be saved or shared from there too. On a phone, "Add to Home screen" in the browser's menu gives the site its own icon.

Things worth knowing before you start:

- **Pictures cost money**, usually a few cents each, billed by the service to your own account. Both services want a payment method on file before they make pictures.
- **Google** needs billing turned on for the key. **OpenAI** needs prepaid credit and an identity check, which takes longer. **OpenRouter** needs some credit added to the account. If any of these is missing, the page tells you which.
- **OpenRouter is one account for many models.** It sells access to image models from Google, OpenAI, Microsoft, Black Forest Labs and others, and Setup lets you choose among them from a short list. The page suggests Google's Nano Banana 2.1 there, the cheapest of the leading ones.
- Services rename their models now and then. If pictures stop working with a message about an unknown model, the current name goes under **Advanced** in Setup. The defaults are `gemini-nano-banana-2.1` and `gpt-image-2.5-sunburst`.

The Google connection has made real pictures (ten on 2026-11-25, through the page as a visitor uses it). The OpenAI and OpenRouter connections were written from those services' documentation and are covered by tests that pin the documented request and response shapes; they have not yet made a real picture, so expect to fix a detail or two on first use.

## Who wears it, and where

For the **Mannequin** and **On a model** looks, more choices appear under the look. Each starts on an answer that says nothing, so the picture model decides for itself, which is why the same pieces can come back on a man one time and a woman the next.

- **Worn by:** *Either*, *A woman* or *A man*.
- **Build:** *Any*, *Slim*, *Average* or *Plus-size*.
- **Setting** (on a model only): *Plain studio*, *City street* or *Outdoors*. The plain studio is the easiest to judge pieces against.

The page remembers these, the look and the "add plain basics" tick for your next visit. While a piece has no name, a tip under the pieces suggests typing one: a name helps the model keep an unusual piece right. With a model on your own computer the tips are firmer, because it needs them more: name every piece, describe anything unusual in Notes, and prefer "On a model" to a flat lay.

Checked on Google's model (2026-11-26), eight pictures: a woman's and a man's mannequin, a woman and a man as the model, a plus-size woman on a city street, a slim man outdoors, a plus-size mannequin and a plus-size woman in the studio. Each came out as asked, with the pieces, print and lettering kept.

## Free alternative: a model on your own computer

If your computer has a good graphics card, it can make the pictures itself, at no cost. In Setup choose **This computer** and follow its three steps:

1. Say what kind of computer it is. The page often recognises the graphics card and suggests an answer; it cannot read how much memory the card has, so check the suggestion.
2. Install [Lemonade](https://lemonade-server.ai), a free app that runs AI models locally, and open it.
3. Press **Connect**. The page finds the app, offers the model that suits your computer, and can start the download for you (the standard model is about 16 GB). While it downloads, the page shows how far it has got, the speed in megabits per second and roughly how long is left. The app does the downloading, so the page can be closed meanwhile: press Connect when you come back and it picks the download up where it is.

Things worth knowing:

- **It needs Chrome, Edge or Firefox.** They ask once whether this site may reach apps on your device; choose Allow. Safari does not permit it, so it does not work on iPhones or iPads either.
- **On the website, the app has to be told to accept it,** once, with one line pasted into a terminal. The page shows the exact line when it is needed. Running fitbash locally (`npm start`) needs no such step.
- **Speed depends on the graphics card.** A recent card makes a picture in seconds to a minute; without one it can take many minutes, and a paid service is the practical choice.
- **The app needs one more step, once:** a line pasted into a terminal that tells its picture engine to work in far less graphics memory. Without it the engine runs out of memory as soon as an outfit has two pieces or more, on any card: measured on the real app, four pieces asked for 41 GB. Setup shows the line after you connect and puts it away once the app reports it done.
- **The suggested models combine up to four pieces.** Given more, they leave some out, so the page asks you to remove some first. The paid services take eight. Within four, nothing went missing in the pictures measured, but pieces were changed: see below.
- **A one-piece outfit is the fragile case on a 12 GB card with the standard model.** The app puts the whole model on the card at once for it, and with the computer simply in use that failed 5 requests in 8. For that model on a 12 to 16 GB card Setup's line therefore carries one option more (`--max-vram 8`), which made it work 5 times in 5 with a gigabyte of the card held by another program, at the same speed. The larger model does not have this fault. Closing games and other programs that use the card still helps on any card.
- **Making the same outfit again gives a new picture.** The app would otherwise repeat the same one exactly, so the page asks for a different one each time.
- **Local models are less exact** than the paid services, most of all on prints and lettering. The quality check below still works with a local model, and still costs its few cents.
- **Local models need telling.** Measured on a 12 GB card (2026-11-26, 19 pictures): an unusual piece with no name was swapped for a plain one three times in three; named "oversized clown shoes" it was drawn, though smaller than the piece; with a note about its size as well it kept its size three times in three. And none of six flat lays came out clean (shoes or trousers nobody supplied, pieces lying on each other), where the same pieces on a model were kept in thirteen pictures of thirteen. The page says both when a local model is chosen. A second run (14 pictures) traced the invented trousers and shoes to the sentence that lets the model add missing basics: without it, none in ten. The pieces still lay on each other in nine of ten, with or without a note asking for gaps, so that is taken as these models' limit.
- **Basics are offered only for what is missing.** The page reads the names typed under the pieces: with bottoms and shoes both named it tells the model to add nothing; with only one of them named it offers the other alone. A piece with no name, or a name in another language than English, leaves the instruction as it was.
- Any app that offers the same interface works: put its address under **Advanced** in Setup (for example `http://127.0.0.1:1234/v1` for stable-diffusion.cpp's server, started with this site in its `--cors-origins`).

This path was written from Lemonade's documentation and tested against a stand-in for the app; since 2026-11-25 it has also been measured on the real app by a session on the owner's computer (Windows, an NVIDIA card with 12 GB; `docs/reports/WO-01.md` has every number). What that showed:

- The page recognises the card, finds the app, lists the models, and its download readout agrees with the app's own window (which counts in 1024s where the page counts in decimal GB and megabits a second).
- The step above is what makes outfits work. Without the engine's `--diffusion-fa` option every outfit of two to four pieces failed (14 of 14); with it every one was made (20 of 20), in 19 to 53 seconds. The app's own message for those failures was only "sd-server request failed", so the page now shows the engine's words and says what to try.
- When the model has to add bottoms to a lone top, the instruction names them outright ("plain full-length trousers"). Asked for "a plain one", the standard model gave shorts with separate lower legs in 4 pictures of 11; with the new wording, none in 28.
- From one to four pieces, no piece went missing in 18 different pictures. What suffers is exactness: the standard model redrew lettering with wrong letters, neither model kept oversized clown shoes oversized, a hat changed colour, and both added a bracelet or ring nobody supplied to most outfits of several pieces.
- The larger model, `Flux-2-Klein-9B-GGUF`, ran on the 12 GB card with the same step, took about one and a half times as long, and kept lettering and small details clearly better.

Not measured: any card that is not 12 GB, a Mac, and a download that is interrupted.

## Which models, and why

The defaults were chosen from public rankings and the services' own documentation (read in November 2026). They have not yet been compared side by side on real clothes, which is the test that matters; treat this as the reasoning, not a result.

- **OpenAI `gpt-image-2.5-sunburst`.** In the top four of the Artificial Analysis image-editing ranking, and reported to lead the Arena ranking for edits from several pictures. `gpt-image-2.6-sunburst` ranks slightly higher and costs more per picture; put its name under **Advanced** in Setup to use it.
- **Google `gemini-nano-banana-2.1`.** About tenth in the same ranking, but it takes the most reference pictures (14, per Google) and costs about 4 cents a picture, the least of the leaders.
- **All of them are weakest where it matters most here.** A published test of earlier versions of these models on 850 products found a product's details kept only about 28% of the time, with distorted logos and lettering the commonest fault. That is why the quality check exists.
- **A first real run, on Google's model (2026-11-25).** Four product photos (a tee with a cartoon print and two words of lettering, jeans, a jacket, sneakers) went through the page as six outfit pictures, flat lays and on a model. Every supplied piece appeared in every picture, and the print and its lettering came through unchanged each time, as did the colours and details such as a leather patch and red toe caps. Two faults showed, both in what the model was asked: it dressed a lone tee with a cap and a watch nobody supplied, and in a square flat lay it shortened the jeans and laid the shoes on top of them. The instruction now forbids added accessories and asks for every piece whole, flat lays are upright, and a second run of both cases came out right. The sample is small, the product photos were themselves made by the model, and a photo of clothes on a hanger or a person is a harder case that has not been tried. A picture took 9 to 22 seconds and, by Google's price list and the token counts it reported, about 4 cents.
- **A harder look at the same model (2026-11-26, 24 pictures).** Against Google's higher tier, Nano Banana Pro, on four hard outfits the model the page uses was the better one: Pro cut the person off at the mouth in two pictures of four despite "head to toe", turned very wide jeans into culottes with the pockets on the wrong side, and by Google's own count read each reference picture at half the detail. So the default stays. The same run showed the page's model keeping all eight pieces of an eight-piece outfit (lettering on a tote and a beanie's label included) on a model, a mannequin and as a flat lay, and taking the piece cleanly out of a photo of a hoodie on an unmade bed, a mirror selfie, and boots standing among other shoes. Two faults showed and were fixed in the instruction: a shirt given as a mirror selfie came back on a model with that man's face and hair (the instruction now says to take the item only and never copy the person), and in flat lays pieces lay on each other, a jacket over the tee and shoes on the jeans' hems (it now asks for bare background around every piece, front side up and unfolded; three outfits came out right, eight pieces among them).
- **Unusual shapes (2026-11-25).** A run on real shop photos (a shirt on a hanger, tie-dye jeans, a hat, a pendant, clown shoes) kept every piece except one: the oversized clown shoes came out as ordinary-sized checkered sneakers. The same happened with made-up test pieces, and enormous wide-leg jeans came out merely baggy. Typing a name for the piece ("oversized clown shoes") helped only partly. The instruction now asks for each piece's own shape and proportions, however unusual; with that, the shoes and the jeans kept their shape in four pictures out of four, and an ordinary outfit came out as before. Naming a piece in the box under its picture still helps the model, and is worth doing for anything odd.
- **On your own computer**, Lemonade can run two models that combine several pictures on a Windows PC with an NVIDIA card or on a Mac: `Flux-2-Klein-4B`, which the page suggests, and `Flux-2-Klein-9B-GGUF`, which it suggests for graphics cards with 12 GB or more. The larger one ranks higher among open models (1012 against 940 on Artificial Analysis) and is licensed for non-commercial use only. Measured on a 12 GB card (in a computer with 32 GB of ordinary memory) it took about one and a half times as long and kept a lettered print right where the smaller one garbled it, and quality comes first here, so it is the suggestion from 12 GB up. It is a 19 GB download against 15; someone who already has the standard model keeps using it and is told the larger one is there. Neither model simply spills into ordinary memory when it does not fit: without the step described above, both failed.
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
  examples/                  the example on a first visit: three pieces and the outfit this page made from them (all four are generated pictures)
  manifest.webmanifest, icons/   the name and icons a phone uses when the site is put on its home screen
server.js                    optional local server: serves public/ and adds link lookup
src/extract.js               product link to candidate pictures
src/safe-fetch.js            fetching pasted links without reaching private networks
test/                        unit tests for all of the above
test/browser/                the page driven in a real browser
docs/PIPELINE.md             how the cloud session and the session on the owner's graphics card work together
docs/PROGRESS.json           what they are finding out and where it stands; work orders and reports sit beside it
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
- Share an outfit as a link. (Sharing the picture itself is there, through the device's share sheet.)
