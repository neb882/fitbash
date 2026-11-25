// Local helper for fitbash. The page itself does all the outfit generation in
// the browser; this serves it and adds the one thing a browser can't do on its
// own: reading a shop's product page to find the item's picture.

import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { extractFromUrl, fetchImage } from "./src/extract.js";
import { FetchError } from "./src/safe-fetch.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const MAX_BODY_BYTES = 64 * 1024;

// The page carries its own content security policy in a <meta> tag so that it
// also applies on static hosts; these are the extras only a server can set.
const SECURITY_HEADERS = {
  "content-security-policy": "frame-ancestors 'none'",
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
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "That request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "The request wasn't valid JSON.");
  }
}

/**
 * Builds the request handler. `fetchOptions` lets tests reach local servers,
 * and `publicDir` lets them serve another copy of the site.
 */
export function createApp({ fetchOptions = {}, publicDir = PUBLIC_DIR } = {}) {
  async function serveStatic(req, res, pathname) {
    const relative = pathname.endsWith("/") ? `${pathname.slice(1)}index.html` : pathname.slice(1);
    const file = path.join(publicDir, relative);
    if (!file.startsWith(publicDir + path.sep)) throw new HttpError(404, "Not found.");
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

  async function route(req, res) {
    const url = new URL(req.url, "http://localhost");
    const { pathname } = url;

    if (!pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed.");
      return serveStatic(req, res, pathname);
    }

    // The page asks this to learn whether link lookup is available.
    if (pathname === "/api/config" && req.method === "GET") {
      return sendJson(res, 200, { links: true });
    }

    if (pathname === "/api/extract" && req.method === "POST") {
      const body = await readJson(req);
      if (typeof body?.url !== "string") throw new HttpError(400, "Send a link to look up.");
      try {
        return sendJson(res, 200, await extractFromUrl(body.url, fetchOptions));
      } catch (error) {
        if (error instanceof FetchError) throw error;
        // Whatever went wrong reading that page, the visitor still has a way forward.
        console.error("lookup failed:", error);
        throw new FetchError("Couldn't read that page. Copy the picture and paste it here instead.", "unreadable");
      }
    }

    if (pathname === "/api/image" && req.method === "GET") {
      const image = await fetchImage(url.searchParams.get("url") ?? "", fetchOptions);
      res.writeHead(200, { "content-type": image.contentType, "cache-control": "private, max-age=300" });
      return res.end(image.body);
    }

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
  const port = Number.parseInt(process.env.PORT ?? "", 10) || 3000;
  // Listens on this computer only by default: the link lookup fetches whatever
  // address it is given, which is not something to offer the whole network.
  const host = process.env.HOST || "127.0.0.1";
  http.createServer(createApp()).listen(port, host, () => {
    console.log(`fitbash is running at http://${host === "127.0.0.1" ? "localhost" : host}:${port}`);
  });
}
