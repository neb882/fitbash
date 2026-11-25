// fitbash front end: collect item pictures, send them off, show the outfit.

const MAX_EDGE = 1536; // Item pictures are shrunk to this before upload.
const CODE_KEY = "fitbash-code";

const $ = (id) => document.getElementById(id);
const ui = {
  codeForm: $("code-form"),
  code: $("code"),
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
  progress: $("progress"),
  attempts: $("attempts"),
};

const state = {
  config: { maxItems: 8, maxAttempts: 1, check: false, needsCode: false, styles: [], provider: "" },
  items: [], // { id, label, mimeType, data, preview }
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

// ---- access code -----------------------------------------------------------

function savedCode() {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveCode(value) {
  try {
    localStorage.setItem(CODE_KEY, value);
  } catch {
    // Private windows can refuse storage; the field keeps the value for now.
  }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  const code = ui.code.value || savedCode();
  if (code) headers["x-fitbash-code"] = code;
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    ui.codeForm.hidden = false;
    ui.code.focus();
  }
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

/** Shrink any picture to a JPEG of at most MAX_EDGE pixels on its long side. */
async function normalize(blob) {
  const source = await decode(blob);
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

async function addBlob(blob, label = "") {
  if (state.items.length >= state.config.maxItems) {
    setAddStatus(`An outfit takes at most ${state.config.maxItems} pieces. Remove one to add another.`, true);
    return false;
  }
  let picture;
  try {
    picture = await normalize(blob);
  } catch {
    setAddStatus("That file isn't a picture this browser can open.", true);
    return false;
  }
  state.items.push({ id: state.nextId++, label, ...picture });
  renderItems();
  return true;
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
  ui.count.textContent = n ? `${n} of ${state.config.maxItems}` : "";
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

async function fetchPicture(url) {
  const res = await api(`/api/image?url=${encodeURIComponent(url)}`);
  return res.blob();
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
        return { blob: await fetchPicture(candidate.url) };
      } catch {
        return null;
      }
    }),
  );
  const usable = loaded.filter(Boolean);
  if (usable.length === 0) throw new Error("Couldn't load a picture from that page. Copy the picture and paste it instead.");
  if (usable.length === 1) return addBlob(usable[0].blob, title);

  ui.pickerList.replaceChildren(
    ...usable.map(({ blob }, i) =>
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
  setAddStatus("");
  return true;
}

async function addLink(url) {
  setAddStatus("Looking up that link…");
  try {
    const res = await api("/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const { title, candidates } = await res.json();
    if (await showPicker(candidates, title)) {
      if (ui.picker.hidden) setAddStatus("");
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

function attemptCard(attempt) {
  return el("li", { class: "attempt", "data-attempt": String(attempt) }, [
    el("div", { class: "picture" }),
    el("div", { class: "notes" }, [el("h3", {}, [el("span", { text: `Attempt ${attempt}` })])]),
  ]);
}

function card(attempt) {
  let node = ui.attempts.querySelector(`[data-attempt="${attempt}"]`);
  if (!node) {
    node = attemptCard(attempt);
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
  const heading = notes.querySelector("h3");
  const download = notes.querySelector(".download");

  if (review.status !== "reviewed") {
    download.before(el("p", { text: `Not checked: ${review.reason}` }));
    return;
  }
  heading.append(
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

function handleEvent(event) {
  const of = state.config.maxAttempts > 1 ? ` (attempt ${event.attempt} of up to ${state.config.maxAttempts})` : "";
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
      setProgress(state.config.provider === "mock" ? "This is the preview collage. Add an image model key to get a real outfit picture." : "Done.");
      break;
    case "error":
      setProgress(event.message, true);
      break;
  }
}

async function generate() {
  if (state.busy || state.items.length === 0) return;
  state.busy = true;
  updateGenerate();
  ui.attempts.replaceChildren();
  for (const stale of ui.attempts.parentElement.querySelectorAll(".attempts ~ .status")) stale.remove();
  setProgress("Sending your pieces…");

  try {
    const res = await api("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: state.items.map(({ mimeType, data, label }) => ({ mimeType, data, label })),
        style: document.querySelector('input[name="style"]:checked')?.value,
        fillGaps: ui.fill.checked,
        notes: ui.notes.value,
      }),
    });

    // The server sends one JSON object per line as each step finishes.
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let finished = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === "done" || event.type === "error") finished = true;
        handleEvent(event);
      }
    }
    if (!finished) setProgress("The connection dropped before the picture was finished. Try again.", true);
  } catch (error) {
    setProgress(error.message, true);
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
  ui.codeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveCode(ui.code.value);
    setAddStatus("Access code saved.");
  });

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

async function start() {
  wire();
  ui.code.value = savedCode();
  try {
    state.config = await (await fetch("/api/config")).json();
  } catch {
    setProgress("Couldn't reach the fitbash server.", true);
    return;
  }
  const { config } = state;
  ui.codeForm.hidden = !config.needsCode;
  ui.styles.replaceChildren(
    ...config.styles.map((style) => {
      const input = el("input", { type: "radio", name: "style", value: style.id });
      input.checked = style.id === config.defaultStyle;
      return el("label", {}, [input, el("span", { text: style.label })]);
    }),
  );
  ui.setup.textContent =
    config.provider === "mock"
      ? "No image model is set up yet, so you'll get a plain collage."
      : config.check
        ? "Each picture is checked against your pieces and redone if it's off."
        : "";
  renderItems();
}

start();
