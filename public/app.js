// fitbash front end. Everything, including the calls to the image model, runs
// here in the browser, so the page works from any static host. When the local
// helper server is present it adds product-link lookup.

import { runOutfit } from "./lib/pipeline.js";
import { STYLES, DEFAULT_STYLE } from "./lib/prompt.js";
import { createProvider, PROVIDERS, ProviderError } from "./lib/providers/index.js";
import { createCritic, DEFAULT_CRITIC_MODEL } from "./lib/critic.js";

const MAX_EDGE = 1536; // Item pictures are shrunk to this before they are sent.
const MAX_ITEMS = 8;
const MAX_ATTEMPTS = 2; // One redo when the check finds a problem.
const SETTINGS_KEY = "fitbash-settings";

const $ = (id) => document.getElementById(id);
const ui = {
  dropzone: $("dropzone"),
  items: $("items"),
  empty: $("empty"),
  count: $("count"),
  linkForm: $("link-form"),
  link: $("link"),
  browse: $("browse"),
  files: $("files"),
  addStatus: $("add-status"),
  picker: $("picker"),
  pickerList: $("picker-list"),
  pickerCancel: $("picker-cancel"),
  styles: $("styles"),
  fill: $("fill"),
  notes: $("notes"),
  generate: $("generate"),
  setup: $("setup"),
  settings: $("settings"),
  settingsSummary: $("settings-summary"),
  provider: $("provider"),
  providerFields: $("provider-fields"),
  providerKey: $("provider-key"),
  providerKeyLabel: $("provider-key-label"),
  providerKeyLink: $("provider-key-link"),
  providerModel: $("provider-model"),
  claudeKey: $("claude-key"),
  claudeModel: $("claude-model"),
  forget: $("forget"),
  progress: $("progress"),
  attempts: $("attempts"),
};

const state = {
  items: [], // { id, label, mimeType, data, preview }
  settings: {
    provider: "mock",
    geminiKey: "",
    geminiModel: "",
    openaiKey: "",
    openaiModel: "",
    claudeKey: "",
    claudeModel: "",
  },
  linkLookup: false, // true when the local helper server answers
  busy: false,
  nextId: 1,
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) node.append(child);
  return node;
}

// ---- settings --------------------------------------------------------------

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    for (const key of Object.keys(state.settings)) {
      if (typeof saved[key] === "string") state.settings[key] = saved[key];
    }
  } catch {
    // No storage (private window) or a damaged entry: start from the defaults.
  }
  if (!PROVIDERS[state.settings.provider]) state.settings.provider = "mock";
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch {
    // The settings still apply until the page is closed.
  }
}

function checkIsOn() {
  return state.settings.provider !== "mock" && Boolean(state.settings.claudeKey);
}

/** Fill the Settings fields from state, for the chosen image model. */
function renderSettings() {
  const { settings } = state;
  const chosen = PROVIDERS[settings.provider];
  ui.provider.value = settings.provider;

  ui.providerFields.hidden = settings.provider === "mock";
  if (settings.provider !== "mock") {
    ui.providerKeyLabel.textContent = `${chosen.label} API key`;
    ui.providerKeyLink.href = chosen.keyUrl;
    ui.providerKey.value = settings[`${settings.provider}Key`];
    ui.providerModel.value = settings[`${settings.provider}Model`];
    ui.providerModel.placeholder = chosen.defaultModel;
  }
  ui.claudeKey.value = settings.claudeKey;
  ui.claudeModel.value = settings.claudeModel;
  ui.claudeModel.placeholder = DEFAULT_CRITIC_MODEL;

  const missingKey = settings.provider !== "mock" && !settings[`${settings.provider}Key`];
  ui.settingsSummary.textContent =
    settings.provider === "mock"
      ? "Preview collage. Choose an image model for real pictures."
      : missingKey
        ? `${chosen.label}: add your API key`
        : `${chosen.label}${checkIsOn() ? ", quality check on" : ""}`;
  ui.setup.textContent =
    settings.provider === "mock"
      ? "No image model chosen yet, so you'll get a plain collage. See Settings."
      : missingKey
        ? "Add your API key in Settings first."
        : checkIsOn()
          ? "Each picture is checked against your pieces and redone once if it's off."
          : "";
}

function wireSettings() {
  ui.provider.replaceChildren(
    ...Object.entries(PROVIDERS).map(([id, provider]) => el("option", { value: id, text: provider.label })),
  );
  ui.provider.addEventListener("change", () => {
    state.settings.provider = ui.provider.value;
    saveSettings();
    renderSettings();
  });
  const bind = (input, key) =>
    input.addEventListener("input", () => {
      state.settings[key()] = input.value.trim();
      saveSettings();
      renderSettings();
    });
  bind(ui.providerKey, () => `${state.settings.provider}Key`);
  bind(ui.providerModel, () => `${state.settings.provider}Model`);
  bind(ui.claudeKey, () => "claudeKey");
  bind(ui.claudeModel, () => "claudeModel");

  ui.forget.addEventListener("click", () => {
    state.settings.geminiKey = state.settings.openaiKey = state.settings.claudeKey = "";
    saveSettings();
    renderSettings();
  });
}

// ---- items -----------------------------------------------------------------

function setAddStatus(text, isError = false) {
  ui.addStatus.textContent = text;
  ui.addStatus.classList.toggle("error", isError);
}

async function decode(blob) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to the <img> decoder, which handles a few more formats.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Shrink a decoded picture to a JPEG of at most MAX_EDGE pixels on its long side. */
function normalize(source) {
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // JPEG has no transparency; cut-outs get a white backdrop.
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const preview = canvas.toDataURL("image/jpeg", 0.9);
  return { mimeType: "image/jpeg", data: preview.slice(preview.indexOf(",") + 1), preview };
}

function hasRoom() {
  if (state.items.length < MAX_ITEMS) return true;
  setAddStatus(`An outfit takes at most ${MAX_ITEMS} pieces. Remove one to add another.`, true);
  return false;
}

function addPicture(source, label = "") {
  state.items.push({ id: state.nextId++, label, ...normalize(source) });
  renderItems();
}

async function addBlob(blob, label = "") {
  if (!hasRoom()) return false;
  try {
    addPicture(await decode(blob), label);
    return true;
  } catch {
    setAddStatus("That file isn't a picture this browser can open.", true);
    return false;
  }
}

function renderItems() {
  ui.items.replaceChildren(
    ...state.items.map((item, index) =>
      el("li", { class: "item" }, [
        el("img", { src: item.preview, alt: item.label || `Piece ${index + 1}` }),
        el("button", {
          class: "remove",
          type: "button",
          "aria-label": `Remove ${item.label || `piece ${index + 1}`}`,
          text: "×",
          onclick: () => {
            state.items = state.items.filter((other) => other.id !== item.id);
            renderItems();
          },
        }),
        el("input", {
          type: "text",
          value: item.label,
          maxlength: "80",
          placeholder: "What is it? e.g. frog tee",
          "aria-label": `Name of piece ${index + 1}`,
          oninput: (event) => {
            item.label = event.target.value;
          },
        }),
      ]),
    ),
  );
  const n = state.items.length;
  ui.empty.hidden = n > 0;
  ui.count.textContent = n ? `${n} of ${MAX_ITEMS}` : "";
  updateGenerate();
}

async function addFiles(files) {
  const pictures = [...files].filter((file) => file.type.startsWith("image/"));
  if (pictures.length === 0) return;
  setAddStatus("Adding…");
  let added = 0;
  for (const file of pictures) {
    if (await addBlob(file)) added++;
    else break;
  }
  if (added === pictures.length) setAddStatus("");
}

// ---- links -----------------------------------------------------------------

async function helper(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      // Keep the generic message.
    }
    throw new Error(message);
  }
  return res;
}

function closePicker() {
  for (const img of ui.pickerList.querySelectorAll("img")) URL.revokeObjectURL(img.src);
  ui.pickerList.replaceChildren();
  ui.picker.hidden = true;
}

async function showPicker(candidates, title) {
  closePicker();
  const loaded = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        return await (await helper(`api/image?url=${encodeURIComponent(candidate.url)}`)).blob();
      } catch {
        return null;
      }
    }),
  );
  const usable = loaded.filter(Boolean);
  if (usable.length === 0) throw new Error("Couldn't load a picture from that page. Copy the picture and paste it instead.");
  if (usable.length === 1) return addBlob(usable[0], title);

  ui.pickerList.replaceChildren(
    ...usable.map((blob, i) =>
      el("li", {}, [
        el(
          "button",
          {
            type: "button",
            "aria-label": `Use picture ${i + 1}`,
            onclick: async () => {
              closePicker();
              if (await addBlob(blob, title)) setAddStatus("");
            },
          },
          [el("img", { src: URL.createObjectURL(blob), alt: "" })],
        ),
      ]),
    ),
  );
  ui.picker.hidden = false;
  return true;
}

/** With the local helper: read the shop page and offer its pictures. */
async function addLinkViaHelper(url) {
  const res = await helper("api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const { title, candidates } = await res.json();
  return showPicker(candidates, title);
}

/**
 * Without the helper, a browser can only use a link that points straight at a
 * picture, and only when the picture's host allows other sites to read it.
 */
async function addLinkDirectly(url) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.referrerPolicy = "no-referrer";
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw new Error(
      "This version of fitbash can't read shop pages. Copy the item's picture and paste it here instead.",
    );
  }
  addPicture(img);
  return true;
}

async function addLink(url) {
  if (!hasRoom()) return;
  setAddStatus("Looking up that link…");
  try {
    const added = state.linkLookup ? await addLinkViaHelper(url) : await addLinkDirectly(url);
    if (added) {
      setAddStatus("");
      ui.link.value = "";
    }
  } catch (error) {
    setAddStatus(error.message, true);
  }
}

// ---- generate --------------------------------------------------------------

function updateGenerate() {
  ui.generate.disabled = state.busy || state.items.length === 0;
  ui.generate.textContent = state.busy ? "Working…" : "Make the outfit";
}

function setProgress(text, isError = false) {
  ui.progress.textContent = text;
  ui.progress.classList.toggle("error", isError);
}

function card(attempt) {
  let node = ui.attempts.querySelector(`[data-attempt="${attempt}"]`);
  if (!node) {
    node = el("li", { class: "attempt", "data-attempt": String(attempt) }, [
      el("div", { class: "picture" }),
      el("div", { class: "notes" }, [el("h3", {}, [el("span", { text: `Attempt ${attempt}` })])]),
    ]);
    ui.attempts.append(node);
  }
  return node;
}

function showImage(attempt, image) {
  const node = card(attempt);
  const src = `data:${image.mimeType};base64,${image.data}`;
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" }[image.mimeType] ?? "png";
  node.querySelector(".picture").replaceChildren(el("img", { src, alt: `Generated outfit, attempt ${attempt}` }));
  node.querySelector(".notes").append(
    el("a", { class: "download", href: src, download: `fitbash-outfit-${attempt}.${extension}`, text: "Download" }),
  );
}

function showReview(attempt, review) {
  const notes = card(attempt).querySelector(".notes");
  const download = notes.querySelector(".download");

  if (review.status !== "reviewed") {
    download.before(el("p", { text: `Not checked: ${review.reason}` }));
    return;
  }
  notes.querySelector("h3").append(
    el("span", {
      class: `badge ${review.verdict}`,
      text: review.verdict === "pass" ? `Matches your pieces · ${review.score}/10` : `Off in places · ${review.score}/10`,
    }),
  );
  const problems = review.items
    .filter((item) => !item.present || !item.faithful)
    .map((item) => {
      const name = state.items[item.number - 1]?.label || `Piece ${item.number}`;
      return `${name}: ${item.present ? item.problem || "doesn't match its picture" : "missing"}`;
    });
  if (review.otherProblems) problems.push(review.otherProblems);
  if (problems.length) {
    download.before(el("ul", {}, problems.map((text) => el("li", { text }))));
  }
}

function markBest(best, attempts) {
  if (attempts < 2) return;
  const node = card(best);
  node.classList.add("best");
  node.querySelector("h3").append(el("span", { class: "badge pick", text: "Best match" }));
  ui.attempts.prepend(node);
}

function handleEvent(event, maxAttempts) {
  const of = maxAttempts > 1 ? ` (attempt ${event.attempt} of up to ${maxAttempts})` : "";
  switch (event.type) {
    case "generating":
      setProgress(event.attempt === 1 ? `Making the picture${of}. This can take a minute.` : `Redoing it with the check's notes${of}.`);
      break;
    case "image":
      showImage(event.attempt, event.image);
      break;
    case "checking":
      setProgress("Checking the picture against your pieces.");
      break;
    case "review":
      showReview(event.attempt, event.review);
      break;
    case "warning":
      ui.attempts.after(el("p", { class: "status error", text: event.message }));
      break;
    case "done":
      markBest(event.best, event.attempts);
      setProgress(state.settings.provider === "mock" ? "This is the preview collage. Choose an image model in Settings to get a real outfit picture." : "Done.");
      break;
  }
}

async function generate() {
  if (state.busy || state.items.length === 0) return;
  state.busy = true;
  updateGenerate();
  ui.attempts.replaceChildren();
  for (const stale of ui.attempts.parentElement.querySelectorAll(".attempts ~ .status")) stale.remove();
  setProgress("Getting started…");

  const { settings } = state;
  try {
    const provider = createProvider(settings);
    const critic = checkIsOn()
      ? createCritic({ apiKey: settings.claudeKey, model: settings.claudeModel || DEFAULT_CRITIC_MODEL })
      : null;
    const maxAttempts = critic ? MAX_ATTEMPTS : 1;
    const request = {
      items: state.items.map(({ mimeType, data, label }) => ({ mimeType, data, label })),
      style: document.querySelector('input[name="style"]:checked')?.value ?? DEFAULT_STYLE,
      fillGaps: ui.fill.checked,
      notes: ui.notes.value,
    };
    for await (const event of runOutfit(request, { provider, critic, maxAttempts })) {
      handleEvent(event, maxAttempts);
    }
  } catch (error) {
    if (!(error instanceof ProviderError)) console.error(error);
    setProgress(error instanceof ProviderError ? error.message : "Something went wrong while making the picture.", true);
    if (error instanceof ProviderError && /in Settings/.test(error.message)) ui.settings.open = true;
  } finally {
    state.busy = false;
    updateGenerate();
  }
}

// ---- wiring ----------------------------------------------------------------

function isLink(text) {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function wire() {
  ui.linkForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isLink(ui.link.value)) addLink(ui.link.value.trim());
    else setAddStatus("That doesn't look like a link.", true);
  });

  ui.browse.addEventListener("click", () => ui.files.click());
  ui.files.addEventListener("change", async () => {
    await addFiles(ui.files.files);
    ui.files.value = "";
  });
  ui.pickerCancel.addEventListener("click", closePicker);

  document.addEventListener("paste", (event) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      addFiles(files);
      return;
    }
    // Let ordinary typing fields take pasted text themselves.
    if (event.target instanceof HTMLElement && event.target.matches("input, textarea")) return;
    const text = event.clipboardData?.getData("text") ?? "";
    if (isLink(text)) {
      event.preventDefault();
      addLink(text.trim());
    }
  });

  for (const type of ["dragenter", "dragover"]) {
    ui.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      ui.dropzone.classList.add("over");
    });
  }
  ui.dropzone.addEventListener("dragleave", (event) => {
    if (!ui.dropzone.contains(event.relatedTarget)) ui.dropzone.classList.remove("over");
  });
  ui.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    ui.dropzone.classList.remove("over");
    if (event.dataTransfer.files.length) return addFiles(event.dataTransfer.files);
    const link = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
    if (isLink(link)) addLink(link.trim());
  });

  ui.generate.addEventListener("click", generate);
}

/** The local helper server answers api/config; a static host does not. */
async function detectHelper() {
  try {
    const res = await fetch("api/config");
    if (!res.ok) return false;
    return (await res.json()).links === true;
  } catch {
    return false;
  }
}

async function start() {
  loadSettings();
  wire();
  wireSettings();
  renderSettings();
  ui.styles.replaceChildren(
    ...Object.entries(STYLES).map(([id, style]) => {
      const input = el("input", { type: "radio", name: "style", value: id });
      input.checked = id === DEFAULT_STYLE;
      return el("label", {}, [input, el("span", { text: style.label })]);
    }),
  );
  renderItems();

  state.linkLookup = await detectHelper();
  if (!state.linkLookup) {
    ui.link.placeholder = "https://… link to a picture";
    ui.empty.textContent = "Paste a picture anywhere on this page, or drop picture files here.";
  }
}

start();
