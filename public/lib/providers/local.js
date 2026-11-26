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
  medium: {
    // Measured on a 12 GB card (docs/reports/WO-01.md): the larger model ran, took about one and
    // a half times as long, and kept a lettered print right where the standard one garbled it.
    // A picture failed when other programs held about 2 GB of the card.
    model: "Flux-2-Klein-9B-GGUF",
    advice: "Enough for the larger model, which keeps prints and lettering better. The standard model is a smaller download and quicker. Close games and other programs that use the graphics card while a picture is made.",
  },
  large: { model: "Flux-2-Klein-9B-GGUF", advice: "Enough for the larger model, which keeps prints and lettering better." },
  apple: {
    model: "Flux-2-Klein-4B",
    advice: "Works on Macs with plenty of memory (16 GB or more). Expect it to be slower than a graphics card.",
  },
  none: {
    model: "Flux-2-Klein-4B",
    advice: "It can run without a graphics card, but one picture may take many minutes. A paid service is the practical choice on this computer.",
  },
};

// What Lemonade's picture engine has to be started with, measured on the real app
// (docs/reports/WO-01.md, a 12 GB NVIDIA card):
//
//   --diffusion-fa     the one that matters. Without it the engine's working room grows with
//                      every piece: 16.7 GB of card memory for two pieces, 41.7 GB for four,
//                      which no card has. Every outfit of two to four pieces failed without it
//                      (14 of 14) and was made with it (20 of 20).
//   --offload-to-cpu   keeps the model in ordinary memory between pictures. Alone it fixed
//                      nothing; beside the other it was a little faster on several pieces and
//                      left the card about 3 GB freer.
//
// Lemonade adds --diffusion-fa itself on its Vulkan engine and not on the NVIDIA one.
const MEMORY_OPTIONS = "--diffusion-fa --offload-to-cpu";

// A limit on what the engine plans to put on the card, for the one model and kind of card it was
// measured on (docs/reports/WO-03.md, a 12 GB card). For a one-piece outfit the engine otherwise
// puts the whole standard model on the card in one block and then wants 2.5 GB of working room
// beside it: with the owner simply using the computer that failed 5 requests in 8. With an 8 GiB
// limit the engine splits the work as it already does for several pieces: 5 of 5 with a gigabyte
// held by another program, at the same speed. The larger model is split anyway and never met this.
// Not measured: any other card, so no other card is given the option.
const ROOM_OPTIONS = { "Flux-2-Klein-4B": { medium: "--max-vram 8" } };

const saved = (model, option) => new RegExp(`(^|\\s)${option}(\\s|$)`).test(model.savedOptions ?? "");

/**
 * The line to paste into a terminal before the app's picture engine can be relied on, as
 * { command, lacks }, or null when it doesn't apply to this model or has been done.
 *
 *   lacks "pieces"  --diffusion-fa is not saved: an outfit of two pieces or more runs out of memory
 *   lacks "room"    that is saved, but not the limit this model wants on this kind of card:
 *                   a one-piece outfit fails while other programs are using the card
 */
export function localEngineStep(model, tier) {
  if (model?.recipe !== "sd-cpp") return null;
  // The name comes from the app and ends up in a terminal: only plain names are passed on.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model.id)) return null;
  const room = ROOM_OPTIONS[model.id]?.[tier] ?? "";
  const lacks = !saved(model, "--diffusion-fa") ? "pieces" : room && !saved(model, "--max-vram") ? "room" : null;
  if (!lacks) return null;
  const options = [MEMORY_OPTIONS, room].filter(Boolean).join(" ");
  return { lacks, command: `lemonade load ${model.id} --sdcpp-args "${options}" --save-options` };
}

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

export function createLocalProvider({ baseUrl, model, fetchImpl = fetch, random = Math.random }) {
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
      // Seen with the real app: left alone it uses the same seed every time, so making the same
      // outfit again returned the very same picture, byte for byte.
      form.set("seed", String(Math.floor(random() * 2 ** 31)));
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
                ? "Your graphics card ran out of room for this picture. Close games and other programs that use the card, then try again. If it still fails, pick a smaller model in Setup."
                : // Seen with the real app: its engine says only "generate_image returned no results", and each
                  // time the cause was the card's memory. Fewer pieces is not the cure: with the card nearly
                  // full, one piece was the outfit that failed.
                  "The app on your computer couldn't make that picture. Most often the graphics card ran out of room: close games and other programs that use the card, then try again.";
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
 *   { status: "connected", models: [{ id, sizeGb, downloaded, recipe, savedOptions }] }
 *     recipe        which engine inside the app runs the model ("sd-cpp"), or null when it doesn't say
 *     savedOptions  the engine options saved for the model in the app, as typed; "" when there are none
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
      recipe: typeof entry.recipe === "string" ? entry.recipe : null,
      // The saved options, exactly as they were typed; a model nobody saved any for has no such key.
      savedOptions: typeof entry.recipe_options?.sdcpp_args === "string" ? entry.recipe_options.sdcpp_args : "",
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
  const wanted = models.find((model) => model.id === LOCAL_TIERS[tier]?.model);
  return (
    // What is already on the computer comes before a download of many gigabytes.
    (wanted?.downloaded ? wanted : null) ??
    models.find((model) => model.downloaded) ??
    wanted ??
    [...models].sort((a, b) => (a.sizeGb ?? Infinity) - (b.sizeGb ?? Infinity))[0]
  ).id;
}
