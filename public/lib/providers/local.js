// An image model running on the person's own computer, reached through a local
// app that speaks the OpenAI-style image API. Written against Lemonade Server
// (its docs as of 2026-11: port 13305, /v1/images/edits, /v1/models, /v1/pull, /v1/downloads);
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

/**
 * How many pieces a local model can combine, or null when that isn't known.
 *
 * FLUX.2 klein takes up to four reference pictures (its maker's documentation, 2026-11).
 * Seen with the real app: given five, it left two out and made no complaint.
 */
export const localMaxPieces = (modelId) => (/klein/i.test(modelId ?? "") ? 4 : null);

const clean = (baseUrl) => (baseUrl || LOCAL_DEFAULT_URL).replace(/\/+$/, "");

// What an answer says went wrong, wherever it says it: { error: "words" },
// { error: { message } } and { error: "server_error", message } are all in use.
function wordsOf(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return wordsOf(value.message) || wordsOf(value.error);
}

async function errorMessage(res) {
  try {
    const error = (await res.json())?.error;
    // When the picture engine inside Lemonade fails, Lemonade's own message is only
    // "sd-server request failed"; the engine's reason is passed along in the details
    // (Lemonade's source, 2026-11: error.details = { status_code, response }).
    return wordsOf(error?.details?.response) || wordsOf(error);
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
      const most = localMaxPieces(model);
      if (most && images.length > most) {
        throw new ProviderError(
          `The model on your computer combines at most ${most} pieces, and leaves some out when given more. Remove ${images.length - most === 1 ? "one" : "some"} and try again, or choose a paid service in Setup for bigger outfits.`,
        );
      }
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
              : /memory|alloc/i.test(detail)
                ? "Your computer ran out of memory for this picture. Close other programs that use the graphics card and try again with fewer pieces. If it still fails, pick a smaller model in Setup."
                : "The app on your computer couldn't make that picture. Try again with fewer pieces; if that fails too, the model may be too large for this computer.";
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
 * Ask the app to download a model. The app keeps the download as a job of its own
 * and answers at once (Lemonade: `stream` with `subscribe` off), so the page can
 * watch it with readLocalDownloads() and find it again after being closed.
 *
 * Resolves to { started: true }, or { started: false, reason } with the app's own
 * words when it gave any.
 */
export async function startLocalDownload(baseUrl, modelId, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${clean(baseUrl)}/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model_name: modelId, stream: true, subscribe: false }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { started: false, reason: "" };
  }
  if (!res.ok) return { started: false, reason: await errorMessage(res) };
  // Anything but a job means the app didn't take the download on as its own:
  // a stream of events here would end the download the moment the page stopped reading it.
  if (!/json/i.test(res.headers.get("content-type") ?? "")) {
    res.body?.cancel().catch(() => {});
    return { started: false, reason: "" };
  }
  const job = readJob(await res.json().catch(() => null));
  if (!job) return { started: false, reason: "" };
  if (job.state === "failed") return { started: false, reason: job.error };
  return { started: true };
}

const JOB_STATES = { downloading: "downloading", paused: "paused", cancelled: "cancelled", completed: "done", error: "failed" };
const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

function readJob(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.model_name !== "string") return null;
  if (entry.type && entry.type !== "model") return null; // the app also downloads its own parts
  const error = typeof entry.error === "string" ? entry.error : "";
  return {
    modelId: entry.model_name,
    // A state this page doesn't know counts as still going only while the app says it is
    // working on it. Otherwise it is over, and the model list says how it ended.
    state: error ? "failed" : (JOB_STATES[entry.status] ?? (entry.running === true ? "downloading" : "done")),
    doneBytes: count(entry.cumulative_bytes_downloaded) || count(entry.overall_bytes_downloaded),
    totalBytes: count(entry.total_download_size),
    error,
  };
}

/**
 * The downloads the app is looking after, as
 *   [{ modelId, state, doneBytes, totalBytes, error }]
 * with state one of "downloading", "paused", "cancelled", "done", "failed".
 * totalBytes is 0 until the app knows it. The app drops a finished download from
 * its list after half a minute, so a missing one may simply be done.
 *
 * Resolves to null when nothing answered, and to an empty list when the answer
 * couldn't be read.
 */
export async function readLocalDownloads(baseUrl, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${clean(baseUrl)}/downloads`, { signal: AbortSignal.timeout(8_000) });
  } catch {
    return null;
  }
  if (!res.ok) return [];
  const body = await res.json().catch(() => null);
  return Array.isArray(body) ? body.map(readJob).filter(Boolean) : [];
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
