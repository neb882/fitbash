// OpenAI GPT Image models through the image edits endpoint, which takes
// several reference pictures. Shapes follow the image generation guide as of 2026-11.

import { ProviderError, errorFromResponse } from "./errors.js";

const ENDPOINT = "https://api.openai.com/v1/images/edits";

const SIZES = { "1:1": "1024x1024", "3:4": "1024x1536" };
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function createOpenAIProvider({ apiKey, model, quality, fetchImpl = fetch }) {
  return {
    name: "openai",
    model,
    async generate({ prompt, images, aspectRatio }) {
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", prompt);
      form.set("size", SIZES[aspectRatio] ?? SIZES["1:1"]);
      if (quality) form.set("quality", quality);
      images.forEach((img, i) => {
        const blob = new Blob([Buffer.from(img.data, "base64")], { type: img.mimeType });
        form.append("image[]", blob, `item-${i + 1}.${EXTENSIONS[img.mimeType] ?? "png"}`);
      });

      const res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw await errorFromResponse(res, "OpenAI");

      const body = await res.json();
      const data = body?.data?.[0]?.b64_json;
      if (!data) throw new ProviderError("OpenAI answered without a picture.");
      return { mimeType: "image/png", data };
    },
  };
}
