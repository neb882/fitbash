import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./src/config.js";
import { createProvider, ProviderError } from "./src/providers/index.js";
import { createCritic } from "./src/critic.js";
import { runOutfit } from "./src/pipeline.js";
import { extractFromUrl, fetchImage } from "./src/extract.js";
import { FetchError } from "./src/safe-fetch.js";
import { STYLES, DEFAULT_STYLE } from "./src/prompt.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// Item pictures the image models and the check can all read.
const ITEM_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_ITEM_BASE64 = 6 * 1024 * 1024;
const MAX_BODY_BYTES = 40 * 1024 * 1024;

const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "That's too much data. Use fewer or smaller pictures.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "The request wasn't valid JSON.");
  }
}

function codeMatches(expected, given) {
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(String(given ?? "")).digest();
  return crypto.timingSafeEqual(a, b);
}

function validateGenerateRequest(body, config) {
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    throw new HttpError(400, "Add at least one clothing item first.");
  }
  if (body.items.length > config.maxItems) {
    throw new HttpError(400, `Use at most ${config.maxItems} items per outfit.`);
  }
  const items = body.items.map((item, i) => {
    if (!item || !ITEM_TYPES.has(item.mimeType) || typeof item.data !== "string" || !item.data) {
      throw new HttpError(400, `Item ${i + 1} isn't a usable picture.`);
    }
    if (item.data.length > MAX_ITEM_BASE64 || !/^[A-Za-z0-9+/]+=*$/.test(item.data)) {
      throw new HttpError(400, `Item ${i + 1} is too large or damaged.`);
    }
    return { mimeType: item.mimeType, data: item.data, label: String(item.label ?? "").slice(0, 80) };
  });
  return {
    items,
    style: STYLES[body.style] ? body.style : DEFAULT_STYLE,
    fillGaps: Boolean(body.fillGaps),
    notes: String(body.notes ?? "").slice(0, 500),
  };
}

/**
 * Builds the request handler. `deps` lets tests swap the image provider, the
 * check, and the network options.
 */
export function createApp(config, deps = {}) {
  const provider = deps.provider ?? createProvider(config);
  const critic =
    deps.critic !== undefined
      ? deps.critic
      : config.criticEnabled
        ? createCritic({ model: config.criticModel })
        : null;
  const fetchOptions = deps.fetchOptions ?? {};

  async function serveStatic(req, res, pathname) {
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = path.join(PUBLIC_DIR, relative);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, "Not found.");
    let body;
    try {
      body = await readFile(file);
    } catch {
      throw new HttpError(404, "Not found.");
    }
    res.writeHead(200, {
      "content-type": STATIC_TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  }

  async function handleGenerate(req, res) {
    const request = validateGenerateRequest(await readJson(req), config);

    // One JSON object per line, written as each step of the loop finishes,
    // so the page can show what is happening during a long request.
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    });
    const write = (event) => res.write(JSON.stringify(event) + "\n");
    try {
      for await (const event of runOutfit(request, { provider, critic, maxAttempts: config.maxAttempts })) {
        if (res.destroyed) return; // The person left; stop spending on redos.
        write(event);
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) console.error("generate failed:", error);
      write({
        type: "error",
        message: error instanceof ProviderError ? error.message : "Something went wrong while making the picture.",
      });
    }
    res.end();
  }

  async function route(req, res) {
    const url = new URL(req.url, "http://localhost");
    const { pathname } = url;

    if (!pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed.");
      return serveStatic(req, res, pathname);
    }

    if (pathname === "/api/config" && req.method === "GET") {
      return sendJson(res, 200, {
        provider: provider.name,
        check: Boolean(critic),
        maxAttempts: critic ? config.maxAttempts : 1,
        maxItems: config.maxItems,
        needsCode: Boolean(config.accessCode),
        styles: Object.entries(STYLES).map(([id, s]) => ({ id, label: s.label })),
        defaultStyle: DEFAULT_STYLE,
      });
    }

    if (config.accessCode && !codeMatches(config.accessCode, req.headers["x-fitbash-code"])) {
      throw new HttpError(401, "That access code isn't right.");
    }

    if (pathname === "/api/extract" && req.method === "POST") {
      const body = await readJson(req);
      if (typeof body?.url !== "string") throw new HttpError(400, "Send a link to look up.");
      return sendJson(res, 200, await extractFromUrl(body.url, fetchOptions));
    }

    if (pathname === "/api/image" && req.method === "GET") {
      const image = await fetchImage(url.searchParams.get("url") ?? "", fetchOptions);
      res.writeHead(200, { "content-type": image.contentType, "cache-control": "private, max-age=300" });
      return res.end(image.body);
    }

    if (pathname === "/api/generate" && req.method === "POST") return handleGenerate(req, res);

    throw new HttpError(404, "Not found.");
  }

  return async function handler(req, res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    try {
      await route(req, res);
    } catch (error) {
      if (res.headersSent) return res.end();
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
      if (error instanceof FetchError) return sendJson(res, 422, { error: error.message, code: error.code });
      console.error("request failed:", error);
      sendJson(res, 500, { error: "Something went wrong on the server." });
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  let app;
  try {
    app = createApp(config);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  http.createServer(app).listen(config.port, () => {
    const check = config.criticEnabled ? `on (${config.criticModel}, up to ${config.maxAttempts} attempts)` : "off";
    console.log(`fitbash is running at http://localhost:${config.port}`);
    console.log(`image model: ${config.provider}, quality check: ${check}`);
    if (!config.accessCode) console.log("No access code set. Set FITBASH_ACCESS_CODE before putting this online.");
  });
}
