// The checking half of the generate-and-check loop: Claude compares a generated
// outfit picture with the reference pictures and says what, if anything, to fix.

// Formats Claude can read. The mock provider's SVG collage isn't one of them.
const READABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// The API caps each image at 5 MB; base64 length is what counts.
const MAX_BASE64_LENGTH = 5 * 1024 * 1024;

export const DEFAULT_CRITIC_MODEL = "claude-opus-5-5";

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "other_problems", "score", "verdict", "fix_instructions"],
  properties: {
    items: {
      type: "array",
      description: "One entry per reference item, in order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "present", "faithful", "problem"],
        properties: {
          number: { type: "integer", description: "The reference item's number, starting at 1." },
          present: { type: "boolean", description: "The item appears in the generated picture." },
          faithful: {
            type: "boolean",
            description: "Its color, cut and any print or lettering match the reference. False when absent.",
          },
          problem: {
            type: "string",
            description: "What differs from the reference, in a few words. Empty when nothing does.",
          },
        },
      },
    },
    other_problems: {
      type: "string",
      description:
        "Problems not tied to one item: duplicated pieces, unrequested pieces, distorted bodies, captions. Empty when none.",
    },
    score: {
      type: "integer",
      description: "Overall quality from 1 (unusable) to 10 (every item right, clean picture).",
    },
    verdict: { type: "string", enum: ["pass", "fail"] },
    fix_instructions: {
      type: "string",
      description: "When the verdict is fail: direct instructions for the image model's next attempt. Empty on pass.",
    },
  },
};

const SYSTEM = `You check pictures for an outfit-preview app. A person supplies photos of clothing items they own or might buy, and an image model produces one picture showing those items together as an outfit. The person uses that picture to judge whether these exact pieces work together, so a picture that quietly swaps a print, shifts a color or drops an item misleads them, and it does so more than an obviously broken picture would.

You are the check between the image model and the person. Image models often return something that looks polished while having changed the details that matter: a graphic tee's artwork redrawn into something similar, lettering garbled, a pattern simplified, a jacket recolored, one item missing, or the same item shown twice. Compare each reference item with the generated picture and look for exactly these differences. Judge what you can see, not what the picture was probably meant to show.

Pass a picture only when every reference item is present once, can be seen whole, and is recognisably the same garment: the same colors, the same cut, and prints or lettering that match at the size shown. Small differences that come from showing a garment worn or laid out (creases, drape, lighting, a print partly covered by a jacket the person also supplied, a hem tucked a little under a waistband) are fine. A redrawn graphic, wrong text, a wrong color, a missing or duplicated item, a distorted figure, or added captions and borders are all reasons to fail.

The person also needs to see each piece at its full size and the outfit as a whole, so two more things fail a picture even when every garment is drawn correctly. One is a piece that cannot be seen whole: folded over on itself so that part of its length is hidden, shortened, or cut off by the edge of the picture. The other, when the outfit is shown on a person or a mannequin, is a figure that is not in the frame from the top of the head to the shoes: a head cut off by the top edge, or feet by the bottom, hides how the outfit reads on a body.

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

// The SDK is a large file, so it is fetched only when a check actually runs.
let sdkPromise;
const loadSdk = () => (sdkPromise ??= import("../vendor/anthropic-sdk.js"));

/**
 * @param {object} options
 * @param {string} options.apiKey   the person's own Anthropic key
 * @param {string} [options.model]
 * @param {object} [options.client] injected in tests
 */
export function createCritic({ apiKey, model = DEFAULT_CRITIC_MODEL, client }) {
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
      if (!items.every(canRead)) {
        return { status: "skipped", reason: "An item picture is in a format the check can't read." };
      }

      let sdk;
      try {
        sdk = await loadSdk();
      } catch {
        return { status: "skipped", reason: "The check couldn't be loaded." };
      }
      const { Anthropic, betaJSONSchemaOutputFormat } = sdk;
      // The key belongs to the person using the page and never leaves their
      // browser except to Anthropic, which is what this flag acknowledges.
      client ??= new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

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
          output_config: { effort: "medium", format: betaJSONSchemaOutputFormat(REVIEW_SCHEMA) },
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
          return { status: "skipped", reason: "Anthropic rejected the API key." };
        }
        if (error instanceof Anthropic.RateLimitError) {
          return { status: "skipped", reason: "The check is rate limited right now." };
        }
        if (error instanceof Anthropic.APIConnectionError) {
          return { status: "skipped", reason: "The check couldn't reach Anthropic." };
        }
        if (error instanceof Anthropic.APIError) {
          return { status: "skipped", reason: `The check failed (API error ${error.status ?? "unknown"}).` };
        }
        return { status: "skipped", reason: "The check failed unexpectedly." };
      }
    },
  };
}
