// Google Gemini image models ("Nano Banana") through the Interactions API.
// Request and response shapes follow the image generation guide as of 2026-11.

import { ProviderError, errorFromResponse } from "./errors.js";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const API_REVISION = "2026-05-20";

export function parseGeminiImage(body) {
  let image = null;
  for (const step of body?.steps ?? []) {
    if (step?.type !== "model_output") continue;
    for (const block of step.content ?? []) {
      if (block?.type === "image" && block.data) image = block;
    }
  }
  if (!image) return null;
  return { mimeType: image.mime_type || "image/png", data: image.data };
}

export function createGeminiProvider({ apiKey, model, imageSize, fetchImpl = fetch }) {
  return {
    name: "gemini",
    model,
    async generate({ prompt, images, aspectRatio }) {
      const responseFormat = { type: "image", aspect_ratio: aspectRatio };
      if (imageSize) responseFormat.image_size = imageSize;

      const res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
          "api-revision": API_REVISION,
        },
        body: JSON.stringify({
          model,
          input: [
            { type: "text", text: prompt },
            ...images.map((img) => ({ type: "image", mime_type: img.mimeType, data: img.data })),
          ],
          response_format: responseFormat,
        }),
        signal: AbortSignal.timeout(180_000),
      });
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
