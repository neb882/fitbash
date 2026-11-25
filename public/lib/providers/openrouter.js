// OpenRouter: one account and one key for image models from many makers.
// Written against its Images API as documented and as its live catalogue
// answered in 2026-11: POST /api/v1/images, reference pictures in
// `input_references`, the picture back in `data[0].b64_json`.

import { ProviderError, send } from "./errors.js";
import { sniffImageType } from "../base64.js";

const ENDPOINT = "https://openrouter.ai/api/v1/images";

/**
 * The models Setup offers, the suggested one first. `maxPieces` is how many
 * reference pictures the model takes (its `input_references.max` in
 * GET /api/v1/images/models); `options` keeps each to about one megapixel at an
 * everyday quality, so a picture costs cents and not tens of cents.
 * Any other model's id can be typed under Advanced.
 */
export const OPENROUTER_MODELS = [
  { id: "google/gemini-nano-banana-2.1", label: "Google Nano Banana 2.1", maxPieces: 14, options: { resolution: "1K" } },
  { id: "openai/gpt-image-2.5-sunburst", label: "OpenAI GPT Image 2.5", maxPieces: 16, options: { quality: "medium" } },
  { id: "openai/gpt-image-2.6-sunburst", label: "OpenAI GPT Image 2.6", maxPieces: 16, options: { quality: "medium" } },
  { id: "microsoft/mai-image-2.7", label: "Microsoft MAI-Image 2.7", maxPieces: 5, options: {} },
  { id: "black-forest-labs/flux-3-image", label: "FLUX 3 Image", maxPieces: 10, options: { resolution: "1K" } },
  { id: "bytedance-seed/seedream-5-5", label: "Seedream 5.5", maxPieces: 10, options: { resolution: "1K" } },
  { id: "google/gemini-3-pro-image", label: "Google Nano Banana Pro", maxPieces: 14, options: { resolution: "1K" } },
];

function failure(status, body) {
  const error = body?.error ?? {};
  const code = Number(error.code) || status;
  const source = error.metadata?.limit_source;
  const summary =
    code === 401
      ? "OpenRouter didn't accept your key. Check it in Setup."
      : code === 402 && source === "openrouter_in_flight_budget"
        ? "OpenRouter is still settling your last pictures. Wait a minute and try again."
        : code === 402
          ? "Your OpenRouter account needs credit before it makes pictures. Add some in your OpenRouter account, then try again."
          : code === 403 && source === "openrouter_key_limit"
            ? "This key has reached its spending limit. Raise the limit in your OpenRouter account, or connect again in Setup."
            : code === 403
              ? "OpenRouter refused these pictures. Try different pictures or notes, or another model in Setup."
              : code === 429
                ? "OpenRouter is getting too many requests from your account right now. Wait a minute and try again."
                : code === 408 || code === 502 || code === 503
                  ? "That model isn't answering on OpenRouter right now. Try again in a minute, or choose another model in Setup."
                  : "OpenRouter couldn't make that picture. If you set a model name under Advanced in Setup, check it.";
  const detail = typeof error.message === "string" ? error.message : "";
  return new ProviderError(detail ? `${summary} (OpenRouter said: ${detail.slice(0, 240)})` : summary, { status: code, detail });
}

export function createOpenRouterProvider({ apiKey, model, fetchImpl = fetch }) {
  const known = OPENROUTER_MODELS.find((entry) => entry.id === model);
  return {
    name: "openrouter",
    model,
    async generate({ prompt, images, aspectRatio }) {
      if (known && images.length > known.maxPieces) {
        throw new ProviderError(
          `${known.label} takes at most ${known.maxPieces} pieces. Remove some, or choose another model in Setup.`,
        );
      }

      const res = await send(
        fetchImpl,
        ENDPOINT,
        {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model,
            prompt,
            input_references: images.map((img) => ({
              type: "image_url",
              image_url: { url: `data:${img.mimeType};base64,${img.data}` },
            })),
            aspect_ratio: aspectRatio,
            n: 1,
            // Asked for outright: the other form is a link the page is not allowed to fetch.
            response_format: "b64_json",
            ...(known?.options ?? {}),
          }),
          signal: AbortSignal.timeout(240_000),
        },
        "OpenRouter",
      );

      let body = null;
      try {
        body = await res.json();
      } catch {
        // Not JSON: handled below as a failure or as an answer without a picture.
      }
      // A failure part-way through can arrive as a 200 with an error inside.
      if (!res.ok || body?.error) throw failure(res.status, body);

      const picture = body?.data?.[0];
      if (!picture?.b64_json) {
        throw new ProviderError("OpenRouter answered without a picture. Try again, or choose another model in Setup.");
      }
      return { mimeType: picture.media_type || sniffImageType(picture.b64_json), data: picture.b64_json };
    },
  };
}
