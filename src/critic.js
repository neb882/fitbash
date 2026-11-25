// The checking half of the generate-and-check loop: Claude compares a generated
// outfit picture with the reference pictures and says what, if anything, to fix.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

// Formats Claude can read. The mock provider's SVG collage isn't one of them.
const READABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// The API caps each image at 5 MB; base64 length is what counts.
const MAX_BASE64_LENGTH = 5 * 1024 * 1024;

const ReviewSchema = z.object({
  items: z
    .array(
      z.object({
        number: z.number().int().describe("The reference item's number, starting at 1."),
        present: z.boolean().describe("The item appears in the generated picture."),
        faithful: z
          .boolean()
          .describe("Its color, cut and any print or lettering match the reference. False when absent."),
        problem: z.string().describe("What differs from the reference, in a few words. Empty when nothing does."),
      }),
    )
    .describe("One entry per reference item, in order."),
  other_problems: z
    .string()
    .describe("Problems not tied to one item: duplicated pieces, unrequested pieces, distorted bodies, captions. Empty when none."),
  score: z.number().int().describe("Overall quality from 1 (unusable) to 10 (every item right, clean picture)."),
  verdict: z.enum(["pass", "fail"]),
  fix_instructions: z
    .string()
    .describe("When the verdict is fail: direct instructions for the image model's next attempt. Empty on pass."),
});

const SYSTEM = `You check pictures for an outfit-preview app. A person supplies photos of clothing items they own or might buy, and an image model produces one picture showing those items together as an outfit. The person uses that picture to judge whether these exact pieces work together, so a picture that quietly swaps a print, shifts a color or drops an item misleads them, and it does so more than an obviously broken picture would.

You are the check between the image model and the person. Image models often return something that looks polished while having changed the details that matter: a graphic tee's artwork redrawn into something similar, lettering garbled, a pattern simplified, a jacket recolored, one item missing, or the same item shown twice. Compare each reference item with the generated picture and look for exactly these differences. Judge what you can see, not what the picture was probably meant to show.

Pass a picture only when every reference item is present once and is recognisably the same garment: the same colors, the same cut, and prints or lettering that match at the size shown. Small differences that come from showing a garment worn or laid out (folds, drape, lighting, a print partly covered by a jacket the person also supplied) are fine. A redrawn graphic, wrong text, a wrong color, a missing or duplicated item, a distorted figure, or added captions and borders are all reasons to fail.

The reference photos may show the item on a person or against a busy background. Only the garment matters; the generated picture is not expected to copy the person or the setting.

When you fail a picture, write fix_instructions for the image model, which will see the same reference pictures again along with your text. Say concretely what to change and which reference item it concerns, for example: "Item 1 (the t-shirt): the chest print must be the cartoon frog from the reference, not a generic green shape. Item 3 (the sneakers) is missing; add it." Mention only what needs to change.`;

function imageBlock(image) {
  return {
    type: "image",
    source: { type: "base64", media_type: image.mimeType, data: image.data },
  };
}

function canRead(image) {
  return READABLE.has(image.mimeType) && image.data.length <= MAX_BASE64_LENGTH;
}

/**
 * @param {object} options
 * @param {string} options.model
 * @param {Anthropic} [options.client]  injected in tests
 */
export function createCritic({ model, client = new Anthropic() }) {
  return {
    model,
    /**
     * Returns { status: "reviewed", verdict, score, items, otherProblems, fix }
     * or { status: "skipped", reason }. Never throws: a broken check must not
     * cost the person a picture that was already generated.
     */
    async review({ items, generated, fillGaps }) {
      if (!canRead(generated)) {
        return { status: "skipped", reason: "The picture is in a format the check can't read." };
      }
      const readable = items.filter((item) => canRead(item));
      if (readable.length !== items.length) {
        return { status: "skipped", reason: "An item picture is in a format the check can't read." };
      }

      const content = [];
      items.forEach((item, i) => {
        content.push({ type: "text", text: `Reference item ${i + 1}: ${item.label?.trim() || "clothing item"}` });
        content.push(imageBlock(item));
      });
      content.push({ type: "text", text: "The generated outfit picture:" });
      content.push(imageBlock(generated));
      content.push({
        type: "text",
        text: fillGaps
          ? "The person allowed the image model to add plain basics for missing pieces, so plain unrequested pieces are acceptable as long as they don't upstage or replace the supplied items. Review the picture."
          : "The person asked for only the supplied items, apart from the plainest basics needed to keep a figure fully dressed. Review the picture.",
      });

      try {
        const response = await client.beta.messages.parse({
          model,
          max_tokens: 16000,
          system: SYSTEM,
          messages: [{ role: "user", content }],
          output_config: { effort: "medium", format: betaZodOutputFormat(ReviewSchema) },
          // If the model declines for policy reasons, let the API retry on its
          // default fallback model instead of losing the check.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        });

        if (response.stop_reason === "refusal") {
          return { status: "skipped", reason: "The check declined to review this picture." };
        }
        const parsed = response.parsed_output;
        if (!parsed) return { status: "skipped", reason: "The check returned an unreadable answer." };

        return {
          status: "reviewed",
          verdict: parsed.verdict,
          score: Math.min(10, Math.max(1, parsed.score)),
          items: parsed.items,
          otherProblems: parsed.other_problems,
          fix: parsed.fix_instructions,
        };
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError) {
          return { status: "skipped", reason: "The check's API key was rejected." };
        }
        if (error instanceof Anthropic.RateLimitError) {
          return { status: "skipped", reason: "The check is rate limited right now." };
        }
        if (error instanceof Anthropic.APIError) {
          return { status: "skipped", reason: `The check failed (API error ${error.status ?? "unknown"}).` };
        }
        return { status: "skipped", reason: "The check failed unexpectedly." };
      }
    },
  };
}
