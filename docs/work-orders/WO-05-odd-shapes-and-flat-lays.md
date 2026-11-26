# WO-05 Odd shapes and flat lays on the local models

For the worker on the owner's computer. Read `docs/PROGRESS.json` (G8 and G9) first. Everything here uses the
**published site** once its version is no longer `f8c452046030`, with `--computer medium` and each model's
saved options. Nothing on the computer changes.

## Decides

1. **G8, odd shapes.** Both local models have made the oversized clown shoes ordinary-sized in every picture
   so far. If naming the piece, or a note about it, keeps the shape in most pictures, the page will tell
   people with a local model to do that for anything unusual. If neither does, it is the models' limit: the
   page's note about local models will say so, and no more is spent on it.
2. **G9, flat lays.** The flat lay sentence was rewritten for Google's model. If a local model gives a clean
   flat lay with it (every piece there, whole, front side up, none on another), nothing changes. If not, the
   report says how it goes wrong and the page's note about local models gains a line, or the sentence a
   variant.

## Do

**A. The clown shoes** (look "on a model"; the three-piece outfit: grey shirt, tie-dye jeans, checkered clown
shoes). The runner names a piece from its file name, so make three copies of the outfit's folder:

1. *unnamed*: files `01.jpg`, `02.jpg`, `03.jpg`.
2. *named*: `01-grey-shirt.jpg`, `02-tie-dye-jeans.jpg`, `03-oversized-clown-shoes.jpg`.
3. *named, with a note*: the same names, and `--notes "The shoes are oversized clown shoes: about twice as
   long as an ordinary shoe, with big round toes."`

`Flux-2-Klein-9B-GGUF`: three pictures of each of the three. `Flux-2-Klein-4B`: two pictures each of *named*
and *named, with a note*.

**B. Flat lays** (look "flat lay"; named pieces). `Flux-2-Klein-9B-GGUF`: the three-piece outfit twice and
the four-piece outfit with the hat twice. `Flux-2-Klein-4B`: the three-piece outfit twice.

## Measure

A: per picture, the shoes: oversized as in the piece (long, big round toes), larger than ordinary but not as
the piece, or ordinary-sized; and anything else wrong or added. Open each at a size where the shoes can be
judged, and say so.
B: per picture: is every piece there once; whole; front side up; unfolded; clear of the others; and is the
background plain. Seconds for each.

## Budget

19 pictures and about 25 minutes of the card's time. No download.

## Leave as found

Both models' saved options as they are (`--diffusion-fa --offload-to-cpu --max-vram 8` for the standard
model, `--diffusion-fa --offload-to-cpu` for the larger), the standard model loaded.

## Done when

- A has thirteen pictures, each with a verdict on the shoes.
- B has six, each with its five answers.

## Report

`docs/reports/WO-05.md` on the branch `gpu-findings`, merged up from `main` first. Part A as a table of
model × naming → how many kept the shape. `npm test` before pushing. When it is pushed, send one line with
its commit.
