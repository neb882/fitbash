// Google Gemini image models ("Nano Banana") through the Interactions API.
// Request and response shapes follow the image generation guide as of 2026-11.

import { ProviderError, errorFromResponse, send } from "./errors.js";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

// The response doesn't reliably name the picture's format, so read it off the
// first bytes (as they appear in base64).
function sniffMimeType(base64) {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

export function parseGeminiImage(body) {
  let image = null;
  for (const step of body?.steps ?? []) {
    if (step?.type !== "model_output") continue;
    for (const block of step.content ?? []) {
      if (block?.type === "image" && block.data) image = block;
    }
  }
  if (!image) return null;
  return { mimeType: image.mime_type || sniffMimeType(image.data), data: image.data };
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
      }, "Gemini");
      if (!res.ok) throw await errorFromResponse(res, "Gemini");

      const image = parseGeminiImage(await res.json());
      if (!image) {
        throw new ProviderError(
          "Gemini answered without a picture. It may have declined these items; try different pictures or notes.",
        );
      }
      return image;
    },
  };
}
