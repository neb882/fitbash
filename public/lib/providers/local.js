// An image model running on the person's own computer, reached through a local
// app that speaks the OpenAI-style image API. Written against Lemonade Server
// (its docs as of 2026-11: port 13305, /v1/images/edits, /v1/models, /v1/pull);
// stable-diffusion.cpp's sd-server answers the same edit request on its own port.

import { ProviderError } from "./errors.js";
import { base64ToBytes, sniffImageType } from "../base64.js";

/** Where Lemonade listens unless it was set up differently. */
export const LOCAL_DEFAULT_URL = "http://localhost:13305/v1";
export const LOCAL_APP = { name: "Lemonade", url: "https://lemonade-server.ai" };

// Near one megapixel, in multiples of 32 pixels as these models expect.
const SIZES = { "1:1": "1024x1024", "3:4": "896x1152" };
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// A picture can take minutes on a modest computer, more the first time while the model loads.
const GENERATE_TIMEOUT_MS = 20 * 60_000;

/**
 * What Setup says for each kind of computer, and which model it suggests first.
 *
 * The two models named here are the only ones in Lemonade's catalog (2026-11) that
 * combine pictures and run on its stable-diffusion.cpp backend, which is the one that
 * works on Windows with an NVIDIA card and on Macs. The larger ranks higher among open
 * models and is licensed for non-commercial use. README.md, "Which models, and why".
 */
export const LOCAL_TIERS = {
  small: {
    model: "Flux-2-Klein-4B",
    advice: "The standard model may just fit. Expect it to be slow, and close other programs that use the graphics card.",
  },
  medium: { model: "Flux-2-Klein-4B", advice: "A good fit for the standard model." },
  large: { model: "Flux-2-Klein-9B-GGUF", advice: "Enough for the larger model, which keeps details better." },
  apple: {
    model: "Flux-2-Klein-4B",
    advice: "Works on Macs with plenty of memory (16 GB or more). Expect it to be slower than a graphics card.",
  },
  none: {
    model: "Flux-2-Klein-4B",
    advice: "It can run without a graphics card, but one picture may take many minutes. A paid service is the practical choice on this computer.",
  },
};

const clean = (baseUrl) => (baseUrl || LOCAL_DEFAULT_URL).replace(/\/+$/, "");

async function errorMessage(res) {
  try {
    const body = await res.json();
    const error = body?.error;
    return (typeof error === "string" ? error : error?.message) ?? "";
  } catch {
    return "";
  }
}

export function createLocalProvider({ baseUrl, model, fetchImpl = fetch }) {
  const base = clean(baseUrl);
  return {
    name: "local",
    model,
    async generate({ prompt, images, aspectRatio }) {
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", prompt);
      form.set("size", SIZES[aspectRatio] ?? SIZES["1:1"]);
      form.set("n", "1");
      form.set("response_format", "b64_json");
      images.forEach((img, i) => {
        const blob = new Blob([base64ToBytes(img.data)], { type: img.mimeType });
        form.append("image[]", blob, `item-${i + 1}.${EXTENSIONS[img.mimeType] ?? "png"}`);
      });

      let res;
      try {
        res = await fetchImpl(`${base}/images/edits`, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
        });
      } catch (error) {
        throw new ProviderError(
          error?.name === "TimeoutError"
            ? "The app on your computer took too long. Try fewer pieces, or a smaller model in Setup."
            : "Lost touch with the app on your computer. Check that it is still open, then press Connect in Setup.",
        );
      }
      if (!res.ok) {
        const detail = await errorMessage(res);
        const summary =
          res.status === 403
            ? "The app on your computer doesn't accept this website yet. Press Connect in Setup to see how to allow it."
            : res.status === 404 || res.status === 503
              ? "The app on your computer doesn't have that model ready. Press Connect in Setup and check the model."
              : "The app on your computer couldn't make that picture. If this keeps happening, the model may be too large for it.";
        throw new ProviderError(detail ? `${summary} (It said: ${detail.slice(0, 240)})` : summary, {
          status: res.status,
          detail,
        });
      }

      const body = await res.json();
      const data = body?.data?.[0]?.b64_json;
      if (!data) throw new ProviderError("The app on your computer answered without a picture.");
      return { mimeType: sniffImageType(data), data };
    },
  };
}

/**
 * Look for the local app and list the models it has that can combine several pictures.
 *
 * Resolves to one of:
 *   { status: "connected", models: [{ id, sizeGb, downloaded }] }
 *   { status: "refused" }      the app is running but doesn't accept requests from this website
 *   { status: "unreachable" }  nothing answered: not installed, not open, or the browser blocked it
 */
export async function findLocalModels(baseUrl, { fetchImpl = fetch } = {}) {
  const url = `${clean(baseUrl)}/models?show_all=true`;
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
  } catch {
    // A refusal on cross-site grounds looks like a dead connection to a page.
    // A request that asks to read nothing still gets through when the app is there.
    try {
      await fetchImpl(url, { mode: "no-cors", signal: AbortSignal.timeout(8_000) });
      return { status: "refused" };
    } catch {
      return { status: "unreachable" };
    }
  }
  if (res.status === 403) return { status: "refused" };
  if (!res.ok) return { status: "unreachable" };

  let body;
  try {
    body = await res.json();
  } catch {
    return { status: "unreachable" };
  }
  const entries = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  const models = entries
    .filter((entry) => {
      // Lemonade labels what each model can do. An app that gives no labels
      // serves a single model the person chose, so take it as it is.
      if (!Array.isArray(entry?.labels)) return Boolean(entry?.id);
      return entry.labels.includes("edit") && !entry.labels.includes("upscaling");
    })
    .map((entry) => ({
      id: String(entry.id),
      sizeGb: typeof entry.size === "number" ? entry.size : null,
      downloaded: entry.downloaded !== false,
    }));
  return { status: "connected", models };
}

/**
 * Ask the app to download a model. Resolves to { started, finished }:
 *
 *   started   false when the app refused the request straight away
 *   finished  a promise for how the request ended: true when the app reported
 *             success, false when it failed or the connection dropped. The app
 *             may hold the request open for the whole download, so this can
 *             take a long time; watch findLocalModels() for `downloaded` too.
 */
export async function startLocalDownload(baseUrl, modelId, { fetchImpl = fetch } = {}) {
  const finished = fetchImpl(`${clean(baseUrl)}/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model_name: modelId, stream: false }),
  }).then(
    (res) => res.ok,
    () => false,
  );
  // Give the app a moment to refuse; silence after that means it has started.
  const refusedQuickly = await Promise.race([
    finished.then((ok) => !ok),
    new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  return { started: !refusedQuickly, finished };
}

/** The model to offer first for a kind of computer, out of those the app has. */
export function pickLocalModel(models, tier) {
  if (models.length === 0) return null;
  const wanted = LOCAL_TIERS[tier]?.model;
  return (
    models.find((model) => model.id === wanted) ??
    models.find((model) => model.downloaded) ??
    [...models].sort((a, b) => (a.sizeGb ?? Infinity) - (b.sizeGb ?? Infinity))[0]
  ).id;
}
