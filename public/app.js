// fitbash front end. Everything, including the calls to the image model, runs
// here in the browser, so the page works from any static host. When the local
// helper server is present it adds product-link lookup.

import { runOutfit } from "./lib/pipeline.js";
import { STYLES, DEFAULT_STYLE, CHOICES, choiceApplies } from "./lib/prompt.js";
import { createProvider, PROVIDERS, DEFAULT_PROVIDER, ProviderError } from "./lib/providers/index.js";
import { createCritic, DEFAULT_CRITIC_MODEL } from "./lib/critic.js";
import { checkKey } from "./lib/keycheck.js";
import {
  LOCAL_APP,
  LOCAL_DEFAULT_URL,
  LOCAL_TIERS,
  findLocalModels,
  localMaxPieces,
  localEngineStep,
  readLocalDownloads,
  pickLocalModel,
  startLocalDownload,
} from "./lib/providers/local.js";
import { TIERS, guessTier, readGraphicsName, tidyName } from "./lib/hardware.js";
import { createSpeedometer, describeDownload } from "./lib/download-progress.js";
import {
  MAX_OUTFITS,
  clearOutfits,
  describePieces,
  listOutfits,
  outfitPieces,
  removeOutfit,
  saveOutfit,
} from "./lib/history.js";
import { base64ToBytes } from "./lib/base64.js";
import { watchForUpdates } from "./lib/update.js";
import { beginConnect, finishConnect } from "./lib/openrouter-connect.js";

const MAX_EDGE = 1536; // Item pictures are shrunk to this before they are sent.
// The check is billed by picture area, and the generated outfit shows each
// piece smaller than this, so a larger reference would cost more and add nothing.
const CHECK_EDGE = 1024;
const MAX_ITEMS = 8;
const MAX_ATTEMPTS = 2; // One redo when the check finds a problem.
const SETTINGS_KEY = "fitbash-settings";
const DOWNLOAD_POLL_MS = 2000; // How often to ask the local app how a download is going.
const LOST_AFTER_POLLS = 4; // This many unanswered in a row, and the app is taken to be gone.

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
  lookChoices: $("look-choices"),
  nameHint: $("name-hint"),
  fill: $("fill"),
  notes: $("notes"),
  generate: $("generate"),
  setup: $("setup"),
  settings: $("settings"),
  settingsSummary: $("settings-summary"),
  settingsDot: $("settings-dot"),
  stage: $("stage"),
  providers: $("providers"),
  keySetup: $("key-setup"),
  localSetup: $("local-setup"),
  localTier: $("local-tier"),
  localAdvice: $("local-advice"),
  localAppLink: $("local-app-link"),
  localAppText: $("local-app-text"),
  localConnect: $("local-connect"),
  localStatus: $("local-status"),
  localAllow: $("local-allow"),
  localAllowCommand: $("local-allow-command"),
  localAllowCopy: $("local-allow-copy"),
  localMemory: $("local-memory"),
  localMemoryWhy: $("local-memory-why"),
  localMemoryCommand: $("local-memory-command"),
  localMemoryCopy: $("local-memory-copy"),
  localModels: $("local-models"),
  localModel: $("local-model"),
  localDownload: $("local-download"),
  localProgress: $("local-progress"),
  localProgressBar: $("local-progress-bar"),
  localProgressText: $("local-progress-text"),
  localUrl: $("local-url"),
  providerConnect: $("provider-connect"),
  providerConnectButton: $("provider-connect-button"),
  providerModels: $("provider-models"),
  providerModelChoice: $("provider-model-choice"),
  providerKeyLink: $("provider-key-link"),
  providerStep1: $("provider-step-1"),
  providerStep2: $("provider-step-2"),
  providerNote: $("provider-note"),
  providerKey: $("provider-key"),
  providerKeyStatus: $("provider-key-status"),
  providerModel: $("provider-model"),
  claudeKey: $("claude-key"),
  claudeKeyStatus: $("claude-key-status"),
  claudeModel: $("claude-model"),
  forget: $("forget"),
  progress: $("progress"),
  elapsed: $("elapsed"),
  attempts: $("attempts"),
  after: $("after"),
  again: $("again"),
  example: $("example"),
  exampleTry: $("example-try"),
  history: $("history"),
  historyNote: $("history-note"),
  historyList: $("history-list"),
  historyClear: $("history-clear"),
  viewer: $("viewer"),
  viewerPicture: $("viewer-picture"),
  viewerCaption: $("viewer-caption"),
  viewerClose: $("viewer-close"),
};

const state = {
  items: [], // { id, label, mimeType, data, preview, review }
  settings: {
    provider: DEFAULT_PROVIDER,
    geminiKey: "",
    geminiModel: "",
    openaiKey: "",
    openaiModel: "",
    openrouterKey: "",
    openrouterModel: "",
    claudeKey: "",
    claudeModel: "",
    localUrl: "",
    localModel: "", // set once a downloaded model on this computer is chosen
    localTier: "",
    // How the last outfit was asked for, so the next visit starts the same way.
    style: "",
    fillGaps: true,
    wearer: "", // this and the next two are the choices in CHOICES; "" leaves it to the model
    build: "",
    place: "",
  },
  // What the app on this computer last told us; not saved.
  local: { status: "", models: [], downloading: "", progress: null },
  graphics: { name: "", tier: null }, // the browser's best guess at the graphics card
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

// ---- setup ---------------------------------------------------------------

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    for (const key of Object.keys(state.settings)) {
      // Only a saved value of the kind the page expects is taken (text for text, yes/no for yes/no).
      if (typeof saved[key] === typeof state.settings[key]) state.settings[key] = saved[key];
    }
  } catch {
    // No storage (private window) or a damaged entry: start from the defaults.
  }
  if (!PROVIDERS[state.settings.provider]) state.settings.provider = DEFAULT_PROVIDER;
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch {
    // The settings still apply until the page is closed.
  }
}

const isLocal = () => Boolean(PROVIDERS[state.settings.provider].local);
const imageKey = () => state.settings[`${state.settings.provider}Key`] ?? "";
/** True once the chosen service, or the model on this computer, can make pictures. */
const ready = () => Boolean(isLocal() ? state.settings.localModel : imageKey());
const checkIsOn = () => Boolean(ready() && state.settings.claudeKey);

/** Fill the Setup panel from state, for the chosen image service. */
function renderSettings() {
  const { settings } = state;
  const chosen = PROVIDERS[settings.provider];
  for (const input of ui.providers.querySelectorAll("input")) input.checked = input.value === settings.provider;

  ui.keySetup.hidden = isLocal();
  ui.localSetup.hidden = !isLocal();
  ui.providerModel.closest(".field").hidden = isLocal();
  ui.localUrl.closest(".field").hidden = !isLocal();
  if (isLocal()) {
    renderLocal();
  } else {
    ui.providerKeyLink.textContent = chosen.openKeyPage;
    ui.providerKeyLink.href = chosen.keyUrl;
    ui.providerStep1.textContent = chosen.signIn;
    ui.providerStep2.textContent = chosen.createKey;
    ui.providerNote.textContent = chosen.note;
    ui.providerKey.value = imageKey();
    ui.providerModel.value = settings[`${settings.provider}Model`];
    ui.providerModel.placeholder = chosen.defaultModel;

    // A service that offers several models gets a list to choose from; one that
    // can hand over a key after a sign-in gets a button for that.
    ui.providerConnect.hidden = !chosen.connect;
    ui.providerModels.hidden = !chosen.models;
    if (chosen.models) {
      const current = settings[`${settings.provider}Model`] || chosen.defaultModel;
      const listed = chosen.models.some((model) => model.id === current);
      ui.providerModelChoice.replaceChildren(
        ...chosen.models.map((model, index) =>
          el("option", {
            value: model.id,
            text: `${model.label}${index === 0 ? " · suggested" : ""}${model.maxPieces < MAX_ITEMS ? ` · up to ${model.maxPieces} pieces` : ""}`,
          }),
        ),
        ...(listed ? [] : [el("option", { value: current, text: `${current} · set under Advanced` })]),
      );
      ui.providerModelChoice.value = current;
    }
  }
  ui.claudeKey.value = settings.claudeKey;
  ui.claudeModel.value = settings.claudeModel;
  ui.claudeModel.placeholder = DEFAULT_CRITIC_MODEL;

  ui.settingsDot.classList.toggle("on", ready());
  ui.settingsSummary.textContent = ready()
    ? `${chosen.label} connected${checkIsOn() ? ", double-check on" : ""}`
    : "Do this once to get real outfit pictures. It takes a few minutes.";
  ui.setup.textContent = ready()
    ? checkIsOn()
      ? "Each picture is checked against your pieces and redone once if it's off."
      : ""
    : "Setup isn't finished yet, so you'll get a simple collage instead of a real outfit picture.";
}

// ---- a model on this computer ----------------------------------------------

const localTier = () => state.settings.localTier || state.graphics.tier || "";

function setLocalStatus(text, kind = "") {
  ui.localStatus.textContent = text;
  ui.localStatus.classList.toggle("error", kind === "error");
  ui.localStatus.classList.toggle("good", kind === "good");
}

const describeModel = (model) => {
  const most = localMaxPieces(model.id);
  return `${model.id}${model.sizeGb ? ` · ${model.sizeGb} GB` : ""}${most && most < MAX_ITEMS ? ` · up to ${most} pieces` : ""}${model.downloaded ? "" : " · not downloaded yet"}`;
};

/** Fill the "this computer" steps from state. */
function renderLocal() {
  const { settings, local, graphics } = state;
  const tier = localTier();
  ui.localTier.value = tier;
  // Name the card only when it is one the guess was read from; anything else would be noise.
  const recognised = graphics.tier && graphics.tier !== "none" && !settings.localTier;
  const seen = recognised ? `This looks like ${tidyName(graphics.name)}. ` : "";
  ui.localAdvice.textContent = tier ? seen + LOCAL_TIERS[tier].advice : seen;
  ui.localAppLink.textContent = `Get ${LOCAL_APP.name}`;
  ui.localAppLink.href = LOCAL_APP.url;
  ui.localAppText.textContent = `Install this free app and open it. It runs the picture model on your computer.`;
  ui.localUrl.value = settings.localUrl;
  ui.localUrl.placeholder = LOCAL_DEFAULT_URL;

  ui.localAllow.hidden = local.status !== "refused";
  ui.localAllowCommand.textContent = `lemonade config set allowed_origins="${location.origin}"`;

  const showModels = local.status === "connected" && local.models.length > 0;
  ui.localModels.hidden = !showModels;
  if (showModels) {
    const current = ui.localModel.value;
    ui.localModel.replaceChildren(
      ...local.models.map((model) => el("option", { value: model.id, text: describeModel(model) })),
    );
    const wanted =
      [local.downloading, settings.localModel, current].find((id) => id && local.models.some((m) => m.id === id)) ??
      pickLocalModel(local.models, tier);
    ui.localModel.value = wanted;
    const chosenModel = local.models.find((model) => model.id === wanted);
    ui.localDownload.hidden = chosenModel.downloaded || Boolean(local.downloading);
    ui.localModel.disabled = Boolean(local.downloading);
  }

  const memory = localMemoryStep();
  ui.localMemory.hidden = !memory;
  if (memory) {
    ui.localMemoryWhy.textContent = memory.why;
    ui.localMemoryCommand.textContent = memory.command;
  }

  // How far, how fast, how long to go. Not in the status line: that one is read out to
  // people using a screen reader each time it changes, and this changes every two seconds.
  const progress = local.downloading ? local.progress : null;
  ui.localProgress.hidden = !progress;
  if (progress) {
    if (progress.percent === null) ui.localProgressBar.removeAttribute("value");
    else ui.localProgressBar.value = progress.percent;
    ui.localProgressText.textContent = progress.text;
  }
}

const ENGINE_STEP_WHY = {
  pieces: "One more step, done once. Without it the app runs out of graphics memory as soon as an outfit has two pieces or more:",
  room: "One more step for this graphics card, done once. Without it a one-piece outfit often fails while other programs are using the card:",
};

/**
 * The one more step the app's picture engine needs before it can be relied on: { command, why },
 * or null when the model in use isn't run by that engine or already has what it needs.
 */
function localMemoryStep() {
  const { local, settings } = state;
  if (local.status !== "connected") return null;
  const step = localEngineStep(local.models.find((model) => model.id === settings.localModel), localTier());
  return step && { command: step.command, why: ENGINE_STEP_WHY[step.lacks] };
}

/** Use the model picked in the list if it is on this computer; otherwise leave Setup unfinished. */
function adoptLocalModel() {
  const model = state.local.models.find((m) => m.id === ui.localModel.value);
  state.settings.localModel = model?.downloaded ? model.id : "";
  saveSettings();
  if (!model) return;
  if (model.downloaded) {
    // Quality comes first: where a model that keeps pieces better suits this computer and is
    // only a download away, say so instead of leaving it unnoticed in the list.
    const better = state.local.models.find((m) => m.id === LOCAL_TIERS[localTier()]?.model);
    const tip =
      better && better.id !== model.id && !better.downloaded
        ? ` For prints and lettering kept better, choose ${better.id} in the list${better.sizeGb ? ` (a ${better.sizeGb} GB download)` : ""}.`
        : "";
    setLocalStatus(`Connected and ready.${tip}`, "good");
  } else if (!state.local.downloading) {
    setLocalStatus(`Connected. This model has to be downloaded first${model.sizeGb ? ` (${model.sizeGb} GB)` : ""}.`);
  }
}

async function connectLocal() {
  setLocalStatus("Looking for the app…");
  ui.localConnect.disabled = true;
  const found = await findLocalModels(state.settings.localUrl);
  ui.localConnect.disabled = false;
  state.local.status = found.status;
  state.local.models = found.models ?? [];

  if (found.status === "unreachable") {
    const safari = location.protocol === "https:" && navigator.vendor === "Apple Computer, Inc.";
    setLocalStatus(
      safari
        ? "Safari doesn't let a website reach apps on your computer. Open this page in Chrome, Edge or Firefox instead."
        : `Couldn't find the app. Check that ${LOCAL_APP.name} is open. If your browser asks whether this site may reach apps on your device, choose Allow.`,
      "error",
    );
  } else if (found.status === "refused") {
    setLocalStatus("");
  } else if (found.models.length === 0) {
    setLocalStatus("Connected, but the app has no model that can combine several pictures.", "error");
  }
  renderSettings();
  if (found.status === "connected" && found.models.length > 0) {
    adoptLocalModel();
    renderSettings();
    resumeLocalDownload();
  }
}

/** The app keeps downloading while the page is closed: pick a download up where it is. */
async function resumeLocalDownload() {
  if (state.local.downloading) return;
  const waiting = (id) => state.local.models.some((m) => m.id === id && !m.downloaded);
  const jobs = await readLocalDownloads(state.settings.localUrl);
  const job = jobs?.find((j) => (j.state === "downloading" || j.state === "paused") && waiting(j.modelId));
  if (!job || state.local.downloading) return;
  state.local.downloading = job.modelId;
  state.local.progress = null;
  renderSettings();
  watchLocalDownload(job.modelId);
}

async function downloadLocalModel() {
  const id = ui.localModel.value;
  state.local.downloading = id;
  state.local.progress = null;
  renderSettings();
  setLocalStatus("Asking the app to download the model…");
  const download = await startLocalDownload(state.settings.localUrl, id);
  if (state.local.downloading !== id) return; // Setup was changed meanwhile.
  if (!download.started) {
    return stopLocalDownload(`The app wouldn't start the download${saidByApp(download.reason)}. ${insideTheApp(id)}`);
  }
  await watchLocalDownload(id);
}

const insideTheApp = (id) => `Download "${id}" inside ${LOCAL_APP.name} (Model Manager), then press Connect.`;
const saidByApp = (words) => (words ? ` (it said: ${words.slice(0, 160)})` : "");

function stopLocalDownload(message) {
  state.local.downloading = "";
  state.local.progress = null;
  renderSettings();
  setLocalStatus(message, "error");
}

/**
 * Follow a download the app is looking after until the model is there.
 * Every way out of the loop either finishes Setup or says what to do:
 * it must never leave the page just waiting.
 */
async function watchLocalDownload(id) {
  const url = state.settings.localUrl;
  const size = state.local.models.find((m) => m.id === id)?.sizeGb;
  const speed = createSpeedometer();
  let said = ""; // the status line is changed only when the state does, so it isn't read out over and over
  let unanswered = 0;
  let notThere = 0;

  for (let first = true; ; first = false) {
    if (!first) await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_POLL_MS));
    if (state.local.downloading !== id) return; // Setup was changed meanwhile.
    const jobs = await readLocalDownloads(url);
    if (state.local.downloading !== id) return;
    const job = jobs?.find((j) => j.modelId === id);

    if (job?.state === "failed") {
      return stopLocalDownload(`The download didn't finish${saidByApp(job.error)}. ${insideTheApp(id)}`);
    }
    if (job?.state === "cancelled") {
      return stopLocalDownload(`The download was stopped in ${LOCAL_APP.name}. Press "Download it" to start again.`);
    }
    if (job?.state === "downloading" || job?.state === "paused") {
      unanswered = notThere = 0;
      const paused = job.state === "paused";
      const bytesPerSecond = paused ? null : speed.add(job.doneBytes, performance.now());
      state.local.progress = describeDownload({ ...job, bytesPerSecond });
      renderSettings();
      if (said !== job.state) {
        said = job.state;
        setLocalStatus(
          paused
            ? `The download is paused. Resume it inside ${LOCAL_APP.name} to carry on.`
            : `Downloading${size ? ` ${size} GB` : ""}. Keep ${LOCAL_APP.name} open; it can take a while.`,
        );
      }
      continue;
    }

    // Finished, or no longer in the app's list: the model list says whether it is really there.
    const found = jobs ? await findLocalModels(url) : { status: "unreachable" };
    if (state.local.downloading !== id) return;
    if (found.status !== "connected") {
      if (++unanswered >= LOST_AFTER_POLLS) {
        return stopLocalDownload(`Lost touch with ${LOCAL_APP.name} during the download. Open it again and press Connect.`);
      }
      continue;
    }
    unanswered = 0;
    state.local.models = found.models;
    if (found.models.find((m) => m.id === id)?.downloaded) break;
    // The app has a moment between finishing a download and listing the model; after that it isn't coming.
    if (++notThere >= 3) return stopLocalDownload(`The download didn't finish. ${insideTheApp(id)}`);
  }
  state.local.downloading = "";
  state.local.progress = null;
  state.settings.localModel = id; // the model that was asked for is the one to use
  renderSettings();
  adoptLocalModel();
  renderSettings();
}

function wireLocal() {
  ui.localTier.replaceChildren(
    el("option", { value: "", text: "Choose…" }),
    ...Object.entries(TIERS).map(([id, label]) => el("option", { value: id, text: label })),
  );
  ui.localTier.addEventListener("change", () => {
    state.settings.localTier = ui.localTier.value;
    saveSettings();
    renderSettings();
  });
  ui.localConnect.addEventListener("click", connectLocal);
  ui.localModel.addEventListener("change", () => {
    adoptLocalModel();
    renderSettings();
  });
  ui.localDownload.addEventListener("click", downloadLocalModel);
  for (const [button, line] of [
    [ui.localAllowCopy, ui.localAllowCommand],
    [ui.localMemoryCopy, ui.localMemoryCommand],
  ]) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(line.textContent);
        button.textContent = "Copied";
      } catch {
        // No clipboard access: select the line so it can be copied by hand.
        getSelection().selectAllChildren(line);
      }
    });
  }
  ui.localUrl.addEventListener("input", () => {
    state.settings.localUrl = ui.localUrl.value.trim();
    // A different address is a different app: what the old one said no longer holds.
    state.settings.localModel = "";
    state.local = { status: "", models: [], downloading: "", progress: null };
    saveSettings();
    setLocalStatus("");
    renderSettings();
  });
}

const KEY_MESSAGES = {
  checking: ["Checking the key…", false],
  ok: ["This key works.", false],
  rejected: ["That key wasn't accepted. Copy it again from the key page; it's easy to miss a character.", true],
  unknown: ["Couldn't check the key just now. You can still try making an outfit.", false],
};

/** Check a pasted key after a short pause, and say whether it works. */
function watchKey(input, statusLine, service) {
  let timer;
  let latest = 0;
  const show = (status) => {
    const [text, isError] = KEY_MESSAGES[status] ?? ["", false];
    statusLine.textContent = text;
    statusLine.classList.toggle("error", isError);
    statusLine.classList.toggle("good", status === "ok");
  };
  const run = () => {
    clearTimeout(timer);
    const runId = ++latest;
    const key = input.value.trim();
    if (!key) return show("");
    show("checking");
    timer = setTimeout(async () => {
      const result = await checkKey(service(), key);
      if (runId === latest) show(result);
    }, 600);
  };
  input.addEventListener("input", run);
  return { clear: () => (latest++, clearTimeout(timer), show("")) };
}

function wireSettings() {
  ui.providers.replaceChildren(
    ...Object.entries(PROVIDERS).map(([id, provider]) =>
      el("label", {}, [
        el("input", { type: "radio", name: "provider", value: id }),
        el("span", {}, [provider.label, el("small", { text: ` · ${provider.hint}` })]),
      ]),
    ),
  );

  const bind = (input, key) =>
    input.addEventListener("input", () => {
      state.settings[key()] = input.value.trim();
      saveSettings();
      renderSettings();
    });
  bind(ui.providerKey, () => `${state.settings.provider}Key`);
  bind(ui.providerModel, () => `${state.settings.provider}Model`);
  ui.providerModelChoice.addEventListener("change", () => {
    state.settings[`${state.settings.provider}Model`] = ui.providerModelChoice.value;
    saveSettings();
    renderSettings();
  });
  ui.providerConnectButton.addEventListener("click", async () => {
    try {
      // The visitor leaves for OpenRouter and comes back to this same page.
      await beginConnect({ callbackUrl: location.origin + location.pathname });
    } catch {
      setKeyStatus("This browser won't let the page start a sign-in. Do it by hand with the steps below.", true);
    }
  });
  bind(ui.claudeKey, () => "claudeKey");
  bind(ui.claudeModel, () => "claudeModel");
  const providerStatus = watchKey(ui.providerKey, ui.providerKeyStatus, () => state.settings.provider);
  const claudeStatus = watchKey(ui.claudeKey, ui.claudeKeyStatus, () => "claude");

  wireLocal();

  ui.providers.addEventListener("change", (event) => {
    state.settings.provider = event.target.value;
    providerStatus.clear();
    saveSettings();
    renderSettings();
  });
  ui.forget.addEventListener("click", () => {
    for (const key of Object.keys(state.settings)) if (key.endsWith("Key")) state.settings[key] = "";
    providerStatus.clear();
    claudeStatus.clear();
    saveSettings();
    renderSettings();
  });
}

function setKeyStatus(text, isError = false) {
  ui.providerKeyStatus.textContent = text;
  ui.providerKeyStatus.classList.toggle("error", isError);
  ui.providerKeyStatus.classList.toggle("good", !isError && Boolean(text));
}

/** If the visitor is coming back from signing in at OpenRouter, take the key it hands over. */
async function finishOpenRouterConnect() {
  if (!new URLSearchParams(location.search).has("code")) return;
  let key = null;
  let failed = false;
  try {
    key = await finishConnect();
  } catch {
    failed = true;
  }
  // The one-time code has done its work either way; take it out of the address bar.
  history.replaceState(null, "", location.pathname);
  if (!key && !failed) return; // a ?code= that isn't ours

  state.settings.provider = "openrouter";
  if (key) state.settings.openrouterKey = key;
  saveSettings();
  renderSettings();
  ui.settings.open = true;
  if (key) setKeyStatus("Connected to OpenRouter. This key works.");
  else setKeyStatus("The sign-in didn't finish. Press Connect to try again, or use the steps below.", true);
}

/** Glide to a part of the page, or jump there for someone who has asked for less motion. */
const scrolling = () => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

function openSetup() {
  ui.settings.open = true;
  ui.settings.scrollIntoView({ behavior: scrolling(), block: "start" });
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

/** Draw a decoded picture as a JPEG of at most `maxEdge` pixels on its long side. */
function toJpeg(source, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // JPEG has no transparency; cut-outs get a white backdrop.
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.9);
  return { mimeType: "image/jpeg", data: url.slice(url.indexOf(",") + 1), url };
}

/** The copy sent to the image model, plus a smaller one for the check. */
function normalize(source) {
  const { url: preview, ...full } = toJpeg(source, MAX_EDGE);
  const { url: _unused, ...review } = toJpeg(source, CHECK_EDGE);
  return { ...full, preview, review };
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
          placeholder: "What is it?",
          "aria-label": `Name of piece ${index + 1}`,
          oninput: (event) => {
            item.label = event.target.value;
            renderNameHint();
          },
        }),
      ]),
    ),
  );
  const n = state.items.length;
  ui.empty.hidden = n > 0;
  ui.count.textContent = n ? `${n} of ${MAX_ITEMS}` : "";
  ui.exampleTry.disabled = n > 0;
  renderNameHint();
  updateGenerate();
}

/** A name helps the picture model keep a piece right, most of all an odd one: say so while any piece has none. */
function renderNameHint() {
  ui.nameHint.hidden = !state.items.some((item) => !item.label?.trim());
}

/** The three pieces of the example at the top of a first visit, to try the page without hunting for pictures. */
const EXAMPLE_PIECES = [
  { file: "examples/frog-tee.webp", label: "frog tee" },
  { file: "examples/blue-jeans.webp", label: "blue jeans" },
  { file: "examples/sneakers.webp", label: "red and white sneakers" },
];

async function addExamplePieces() {
  if (state.items.length > 0) return;
  ui.exampleTry.disabled = true;
  setAddStatus("Adding…");
  try {
    const blobs = await Promise.all(
      EXAMPLE_PIECES.map(async ({ file }) => {
        const res = await fetch(file);
        if (!res.ok) throw new Error(`no ${file}`);
        return res.blob();
      }),
    );
    for (const [index, blob] of blobs.entries()) await addBlob(blob, EXAMPLE_PIECES[index].label);
    setAddStatus("Added the three example pieces. Now pick a look and press “Make the outfit”.");
    $("pieces-heading").scrollIntoView({ behavior: scrolling(), block: "start" });
  } catch {
    setAddStatus("The example pictures couldn't be loaded. Check your connection, or add pictures of your own.", true);
    ui.exampleTry.disabled = state.items.length > 0;
  }
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
  // The outfit frame shows that work is under way, for eyes and for screen readers.
  ui.stage.setAttribute("aria-busy", String(state.busy));
  ui.generate.disabled = state.busy || state.items.length === 0;
  ui.generate.textContent = state.busy ? "Working…" : "Make the outfit";
  ui.generate.classList.toggle("busy", state.busy);
  ui.again.disabled = state.busy;
}

function setProgress(text, isError = false) {
  ui.progress.textContent = text;
  ui.progress.classList.toggle("error", isError);
}

const TRIES = ["First try", "Second try", "Third try"];

function card(attempt) {
  let node = ui.attempts.querySelector(`[data-attempt="${attempt}"]`);
  if (!node) {
    node = el("li", { class: "attempt", "data-attempt": String(attempt) }, [
      el("figure", { class: "plate" }, [el("div", { class: "picture" }), el("figcaption")]),
      el("div", { class: "notes" }, [el("p", { class: "verdict" }), el("div", { class: "actions" })]),
    ]);
    ui.attempts.append(node);
    // One picture needs no name. Once there are two, each says which it was.
    const cards = [...ui.attempts.children];
    if (cards.length > 1) {
      for (const each of cards) {
        if (each.querySelector(".try")) continue;
        const number = Number(each.dataset.attempt);
        each.querySelector(".verdict").prepend(el("span", { class: "try", text: TRIES[number - 1] ?? `Try ${number}` }));
      }
    }
  }
  return node;
}

/** Whether this browser can hand a picture to the device's own share sheet (messages, mail, other apps). */
function canShare(file) {
  try {
    return Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}

async function share(file) {
  try {
    await navigator.share({ files: [file], title: "My outfit" });
  } catch (error) {
    // Closing the share sheet without choosing anything is not a failure.
    if (error?.name !== "AbortError") setProgress("Sharing didn't work here. Press “Save picture” instead.", true);
  }
}

function showImage(attempt, image, run) {
  const node = card(attempt);
  const src = `data:${image.mimeType};base64,${image.data}`;
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" }[image.mimeType] ?? "png";
  const name = `fitbash-outfit-${attempt}.${extension}`;
  node.querySelector(".picture").replaceChildren(el("img", { src, alt: `Your outfit: ${run.about}` }));
  node.querySelector("figcaption").textContent = run.about;
  const actions = node.querySelector(".actions");
  actions.append(el("a", { class: "download", href: src, download: name, text: "Save picture" }));
  if (!navigator.canShare) return;
  const file = new File([base64ToBytes(image.data)], name, { type: image.mimeType });
  if (canShare(file)) actions.append(el("button", { type: "button", class: "quiet share", text: "Share", onclick: () => share(file) }));
}

function showReview(attempt, review, labels) {
  const notes = card(attempt).querySelector(".notes");
  const actions = notes.querySelector(".actions");

  if (review.status !== "reviewed") {
    actions.before(el("p", { text: `Not checked: ${review.reason}` }));
    return;
  }
  notes.querySelector(".verdict").append(
    el("span", {
      class: `badge ${review.verdict}`,
      text: review.verdict === "pass" ? `Matches your pieces · ${review.score}/10` : `Off in places · ${review.score}/10`,
    }),
  );
  const problems = review.items
    .filter((item) => !item.present || !item.faithful)
    .map((item) => {
      const name = labels[item.number - 1] || `Piece ${item.number}`;
      return `${name}: ${item.present ? item.problem || "doesn't match its picture" : "missing"}`;
    });
  if (review.otherProblems) problems.push(review.otherProblems);
  if (problems.length) {
    actions.before(el("ul", {}, problems.map((text) => el("li", { text }))));
  }
}

function markBest(best, attempts) {
  if (attempts < 2) return;
  const node = card(best);
  node.classList.add("best");
  node.querySelector(".verdict").append(el("span", { class: "badge pick", text: "Best match" }));
  ui.attempts.prepend(node);
}

/**
 * Show one step of a run. `run` holds what was true when the run began (its pieces'
 * names, where it is being made), since the page may be changed while it is under way.
 */
function handleEvent(event, run) {
  const { maxAttempts } = run;
  const of = maxAttempts > 1 ? ` (attempt ${event.attempt} of up to ${maxAttempts})` : "";
  const wait = run.local ? "On your own computer this can take a few minutes." : "This can take a minute.";
  switch (event.type) {
    case "generating":
      setProgress(event.attempt === 1 ? `Making the picture${of}. ${wait}` : `Redoing it with the check's notes${of}.`);
      break;
    case "image":
      showImage(event.attempt, event.image, run);
      break;
    case "checking":
      setProgress("Checking the picture against your pieces.");
      break;
    case "review":
      showReview(event.attempt, event.review, run.labels);
      break;
    case "warning":
      ui.attempts.after(el("p", { class: "status error", text: event.message }));
      break;
    case "done":
      markBest(event.best, event.attempts);
      setProgress(
        run.real
          ? "Your outfit is ready."
          : "This is only a collage of your pieces. Finish Setup at the top of the page to get a real outfit picture.",
      );
      ui.after.hidden = !run.real;
      break;
  }
}

async function generate() {
  if (state.busy || state.items.length === 0) return;
  state.busy = true;
  updateGenerate();
  ui.attempts.replaceChildren();
  ui.after.hidden = true;
  for (const stale of ui.attempts.parentElement.querySelectorAll(".attempts ~ .status")) stale.remove();
  setProgress("Getting started…");
  // On a phone the outfit is further down the page than the button: go there, or the press seems to do nothing.
  // Wherever the frame doesn't fit on the screen, its top is brought to the top, where the progress is.
  const frame = ui.stage.getBoundingClientRect();
  if (frame.top < 0 || (frame.bottom > window.innerHeight && frame.top > 80)) {
    ui.stage.scrollIntoView({ behavior: scrolling(), block: "start" });
  }
  const stopClock = startClock();

  const { settings } = state;
  try {
    // Until setup is finished, the keyless stand-in shows what the page does.
    const provider = createProvider(ready() ? settings : { provider: "mock" });
    const critic = checkIsOn()
      ? createCritic({ apiKey: settings.claudeKey, model: settings.claudeModel || DEFAULT_CRITIC_MODEL })
      : null;
    const maxAttempts = critic ? MAX_ATTEMPTS : 1;
    const request = {
      items: state.items.map(({ mimeType, data, label, review }) => ({ mimeType, data, label, review })),
      style: chosenStyle(),
      ...chosenLook(),
      fillGaps: ui.fill.checked,
      notes: ui.notes.value,
    };
    const run = {
      maxAttempts,
      labels: request.items.map((item) => item.label),
      about: `${STYLES[request.style].label} · ${describePieces(request.items.map((item) => item.label ?? ""))}`,
      real: provider.name !== "mock",
      local: provider.name === "local",
    };
    const made = new Map(); // attempt number to its picture and review, to keep the best one afterwards
    let best = 0;
    for await (const event of runOutfit(request, { provider, critic, maxAttempts })) {
      if (event.type === "image") made.set(event.attempt, { image: event.image });
      if (event.type === "review") made.get(event.attempt).review = event.review;
      if (event.type === "done") best = event.best;
      handleEvent(event, run);
    }
    stopClock(); // the picture is here; keeping a copy below is not part of the wait
    // A stand-in collage isn't an outfit worth keeping.
    if (run.real && made.has(best)) await keepOutfit(made.get(best), request);
  } catch (error) {
    if (!(error instanceof ProviderError)) console.error(error);
    let message =
      error instanceof ProviderError ? error.message : "Something went wrong while making the picture. Try again in a minute.";
    // The app on this computer failed at the picture itself: Setup may have a step for that.
    if (settings.provider === "local" && error instanceof ProviderError && error.status >= 500) {
      if (state.local.status !== "connected") await connectLocal();
      renderSettings();
      if (localMemoryStep()) message += " One more step in Setup usually fixes this; it is shown there now.";
    }
    setProgress(message, true);
    if (error instanceof ProviderError && /in Setup/.test(message)) openSetup();
  } finally {
    stopClock();
    state.busy = false;
    updateGenerate();
  }
}

/** Count the wait where it can be seen, so a slow picture doesn't look like a stuck page. Returns how to stop. */
function startClock() {
  const began = Date.now();
  const show = () => {
    const seconds = Math.floor((Date.now() - began) / 1000);
    ui.elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  show();
  ui.elapsed.hidden = false;
  const ticking = setInterval(show, 1000);
  return () => {
    clearInterval(ticking);
    ui.elapsed.hidden = true;
  };
}

// ---- past outfits ----------------------------------------------------------

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
let pastUrls = []; // object URLs of the pictures on show, released when the grid is redrawn

const chosenStyle = () => document.querySelector('input[name="style"]:checked')?.value ?? DEFAULT_STYLE;

const chosen = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value ?? "";

/** What was chosen beyond the look (who wears it, build, setting). The instruction uses each only where it applies. */
const chosenLook = () => Object.fromEntries(CHOICES.map((choice) => [choice.name, chosen(choice.name)]));

function setChoice(name, id) {
  for (const input of document.querySelectorAll(`input[name="${name}"]`)) input.checked = input.value === id;
}

/** Offer each choice only for the looks it has something to say about. */
function renderLookChoices() {
  for (const choice of CHOICES) $(`${choice.name}-choice`).hidden = !choiceApplies(choice, chosenStyle());
}

/** Keep the outfit just made. The picture is already on the page, so a failure here costs nothing. */
async function keepOutfit({ image, review }, request) {
  try {
    const picture = new Blob([base64ToBytes(image.data)], { type: image.mimeType });
    const checked = review?.status === "reviewed" ? { verdict: review.verdict, score: review.score } : {};
    await saveOutfit(
      { picture, labels: request.items.map((item) => item.label ?? ""), style: request.style, ...Object.fromEntries(CHOICES.map(({ name }) => [name, request[name] ?? ""])), ...checked },
      request.items,
    );
    await renderHistory();
  } catch {
    // No storage (a private window) or no room left.
  }
}

function pastCard(outfit) {
  const url = URL.createObjectURL(outfit.picture);
  pastUrls.push(url);
  const pieces = describePieces(outfit.labels);
  const when = new Date(outfit.createdAt).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  const verdict = outfit.verdict === "pass" ? "matches your pieces" : outfit.verdict === "fail" ? "off in places" : "";
  const about = [STYLES[outfit.style]?.label, when, verdict].filter(Boolean).join(" · ");

  return el("li", { class: "past", "data-outfit": String(outfit.id) }, [
    el(
      "button",
      {
        class: "past-picture",
        type: "button",
        "aria-label": `Show larger: ${pieces}`,
        onclick: () => {
          ui.viewerPicture.src = url;
          ui.viewerPicture.alt = `Outfit: ${pieces}`;
          ui.viewerCaption.textContent = `${pieces} · ${about}`;
          ui.viewer.showModal();
        },
      },
      [el("img", { src: url, alt: `Outfit: ${pieces}`, loading: "lazy" })],
    ),
    el("p", { class: "past-pieces", text: pieces }),
    el("p", { class: "muted", text: about }),
    el("div", { class: "past-actions" }, [
      el("button", { type: "button", class: "quiet", text: "Use these pieces", onclick: () => reusePieces(outfit) }),
      el("a", {
        class: "download",
        href: url,
        download: `fitbash-outfit.${EXTENSIONS[outfit.picture.type] ?? "png"}`,
        text: "Save",
      }),
      el("button", {
        type: "button",
        class: "quiet",
        text: "Remove",
        "aria-label": `Remove: ${pieces}`,
        onclick: async () => {
          await removeOutfit(outfit.id);
          renderHistory();
        },
      }),
    ]),
  ]);
}

async function renderHistory() {
  let outfits;
  try {
    outfits = await listOutfits();
  } catch {
    // The browser won't store anything here (a private window, say). The page works without the list.
    ui.history.hidden = true;
    return 0;
  }
  for (const url of pastUrls) URL.revokeObjectURL(url);
  pastUrls = [];
  ui.history.hidden = outfits.length === 0;
  ui.historyNote.textContent = `The outfits you made here, newest first. They are kept in this browser only, up to ${MAX_OUTFITS}.`;
  ui.historyList.replaceChildren(...outfits.map(pastCard));
  return outfits.length;
}

/** Put a past outfit's pieces and look back into the page, ready to change and make again. */
async function reusePieces(outfit) {
  const pieces = await outfitPieces(outfit.id).catch(() => []);
  if (pieces.length === 0) return setAddStatus("Those pieces are no longer stored.", true);
  state.items = pieces.map(({ label, mimeType, data, review }) => ({
    id: state.nextId++,
    label,
    mimeType,
    data,
    review,
    preview: `data:${mimeType};base64,${data}`,
  }));
  renderItems();
  const look = document.querySelector(`input[name="style"][value="${outfit.style}"]`);
  if (look) look.checked = true;
  for (const { name, options } of CHOICES) if (outfit[name] in options) setChoice(name, outfit[name]);
  renderLookChoices();
  setAddStatus(`Loaded the ${pieces.length === 1 ? "piece" : `${pieces.length} pieces`} of that outfit. Change what you like and make it again.`);
  $("pieces-heading").scrollIntoView({ behavior: scrolling(), block: "start" });
}

function wireHistory() {
  // "Remove all" asks once more before it does anything.
  let armed;
  const disarm = () => {
    clearTimeout(armed);
    armed = undefined;
    ui.historyClear.textContent = "Remove all";
  };
  ui.historyClear.addEventListener("click", async () => {
    if (!armed) {
      ui.historyClear.textContent = "Really remove all?";
      armed = setTimeout(disarm, 5000);
      return;
    }
    disarm();
    await clearOutfits().catch(() => {});
    renderHistory();
  });

  ui.viewerClose.addEventListener("click", () => ui.viewer.close());
  // A click on the dimmed area around the picture closes it too.
  ui.viewer.addEventListener("click", (event) => {
    if (event.target === ui.viewer) ui.viewer.close();
  });
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
  ui.again.addEventListener("click", generate);
  ui.exampleTry.addEventListener("click", addExamplePieces);
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
  wireHistory();
  // Someone with no outfits yet is shown what the page makes before being asked to set anything up.
  renderHistory().then((outfits) => (ui.example.hidden = outfits > 0));

  // A newer version of the site: say so, and leave the reloading to the visitor.
  $("update-reload").addEventListener("click", () => location.reload());
  $("update-later").addEventListener("click", () => ($("update-notice").hidden = true));
  watchForUpdates(() => ($("update-notice").hidden = false));
  renderSettings();
  ui.styles.replaceChildren(
    ...Object.entries(STYLES).map(([id, style]) => {
      const input = el("input", { type: "radio", name: "style", value: id });
      input.checked = id === DEFAULT_STYLE;
      return el("label", {}, [input, el("span", { text: style.label })]);
    }),
  );
  ui.lookChoices.replaceChildren(
    ...CHOICES.map((choice) =>
      el("fieldset", { id: `${choice.name}-choice`, class: "segmented", hidden: true }, [
        el("legend", { class: "field-label", text: choice.label }),
        el(
          "div",
          { class: "segments" },
          Object.entries(choice.options).map(([id, option]) =>
            el("label", {}, [el("input", { type: "radio", name: choice.name, value: id }), el("span", { text: option.label })]),
          ),
        ),
      ]),
    ),
  );
  // Someone making outfits for themselves wants the same answers every time, so they are remembered,
  // along with the look and whether basics are added.
  const { settings } = state;
  if (STYLES[settings.style]) document.querySelector(`input[name="style"][value="${settings.style}"]`).checked = true;
  ui.fill.checked = settings.fillGaps !== false;
  for (const { name, options } of CHOICES) setChoice(name, settings[name] in options ? settings[name] : "");
  const remember = () => {
    Object.assign(settings, { style: chosenStyle(), fillGaps: ui.fill.checked }, chosenLook());
    saveSettings();
  };
  ui.styles.addEventListener("change", () => (renderLookChoices(), remember()));
  ui.lookChoices.addEventListener("change", remember);
  ui.fill.addEventListener("change", remember);
  renderLookChoices();
  renderItems();

  await finishOpenRouterConnect();

  // First visit: show the setup steps instead of hiding them behind a click.
  if (!ready()) ui.settings.open = true;

  // A guess at the graphics card, for the "this computer" choice. It only pre-fills a question.
  state.graphics.name = await readGraphicsName();
  state.graphics.tier = guessTier(state.graphics.name);
  renderSettings();

  state.linkLookup = await detectHelper();
  const touch = window.matchMedia("(pointer: coarse)").matches;
  ui.empty.textContent = touch
    ? "Tap “Add pictures” to choose photos or screenshots of the clothes."
    : `Drop pictures here, or copy one and paste it anywhere on this page${state.linkLookup ? ". Shop links work too." : "."}`;
  if (!state.linkLookup) ui.link.placeholder = "https://… link to a picture";
}

start();
