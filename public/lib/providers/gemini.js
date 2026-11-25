// Google Gemini image models ("Nano Banana") through the Interactions API.
// Request and response shapes follow the image generation guide as of 2026-11.

import { ProviderError, errorFromResponse, send } from "./errors.js";
import { sniffImageType } from "../base64.js";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

export function parseGeminiImage(body) {
  let image = null;
  for (const step of body?.steps ?? []) {
    if (step?.type !== "model_output") continue;
    for (const block of step.content ?? []) {
      if (block?.type === "image" && block.data) image = block;
    }
  }
  if (!image) return null;
  // The response doesn't reliably name the picture's format, so fall back to reading it off the data.
  return { mimeType: image.mime_type || sniffImageType(image.data), data: image.data };
}

export function createGeminiProvider({ apiKey, model, fetchImpl = fetch }) {
  return {
    name: "gemini",
    model,
    async generate({ prompt, images, aspectRatio }) {
      const res = await send(fetchImpl, ENDPOINT, {
        method: "POST",
        // Only these two headers: browsers may not send any others to this API.
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          model,
          input: [
            { type: "text", text: prompt },
            ...images.map((img) => ({ type: "image", mime_type: img.mimeType, data: img.data })),
          ],
          response_format: { type: "image", aspect_ratio: aspectRatio },
        }),
        signal: AbortSignal.timeout(180_000),
      }, "Google");
      if (!res.ok) {
        throw await errorFromResponse(res, "Google", {
          // Google's own words for a key with no billing: "(limit: 0 ... on Free Tier)".
          billingWhen: /free.tier|limit: 0/i,
          billing:
            "Google's free tier makes no pictures. Turn on billing for this key at aistudio.google.com (Google calls it upgrading your tier), then try again.",
        });
      }

      const image = parseGeminiImage(await res.json());
      if (!image) {
        throw new ProviderError(
          "Google answered without a picture. It may have declined these items. Try different pictures or notes.",
        );
      }
      return image;
    },
  };
}
