// Turns a pasted product link into candidate pictures of the item.

import { safeFetch, FetchError } from "./safe-fetch.js";

export const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

const MAX_CANDIDATES = 8;

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => fromCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => fromCode(Number(dec)));
}

// A page can name a character code that doesn't exist; drop it instead of throwing.
const fromCode = (code) => (code <= 0x10ffff ? String.fromCodePoint(code) : "");

// Real tags are far shorter than this. A longer one is skipped, so a page built
// to be slow to read cannot hold the lookup up.
const MAX_TAG = 2000;

/**
 * Every opening tag of one name, in order, as { tag, end }. One pass over the
 * page whatever it contains: the position of the next ">" is remembered, and a
 * page with no ">" left ends the search.
 */
function* openTags(html, lower, name) {
  const needle = `<${name}`;
  let close = -1;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
    if (close < at) {
      close = html.indexOf(">", at);
      if (close === -1) return;
    }
    const next = lower[at + needle.length];
    const isThisTag = next === ">" || next === "/" || /\s/.test(next); // not <metadata>, <linker>, ...
    if (isThisTag && close - at <= MAX_TAG) yield { tag: html.slice(at, close + 1), end: close + 1 };
  }
}

/** The text between an opening tag and its closing tag, or null when it never closes. */
function contentAfter(html, lower, end, name) {
  const close = lower.indexOf(`</${name}`, end);
  return close === -1 ? null : html.slice(end, close);
}

function attributes(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function jsonLdImages(html, lower) {
  const found = [];
  const collect = (value) => {
    if (!value) return;
    if (typeof value === "string") found.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (typeof value === "object") collect(value.url ?? value.contentUrl);
  };
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const types = [].concat(node["@type"] ?? []);
    if (types.some((t) => /^(Product|ProductGroup)$/i.test(String(t)))) collect(node.image);
    if (node["@graph"]) visit(node["@graph"]);
  };
  for (const { tag, end } of openTags(html, lower, "script")) {
    if (!/^application\/ld\+json$/i.test(attributes(tag).type ?? "")) continue;
    const text = contentAfter(html, lower, end, "script");
    if (text === null) break; // No script closes from here on.
    try {
      visit(JSON.parse(text));
    } catch {
      // Shops ship broken JSON-LD often enough; the meta tags still work.
    }
  }
  return found;
}

/**
 * Pull candidate item pictures out of a product page, best guesses first.
 * Returns { title, candidates: [{ url, source }] }.
 */
export function extractFromHtml(html, baseUrl) {
  const seen = new Set();
  const candidates = [];
  const add = (raw, source) => {
    if (!raw || candidates.length >= MAX_CANDIDATES) return;
    let url;
    try {
      url = new URL(raw.trim(), baseUrl);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (/\.svg(\?|$)/i.test(url.pathname)) return;
    if (seen.has(url.href)) return;
    seen.add(url.href);
    candidates.push({ url: url.href, source });
  };

  const lower = html.toLowerCase(); // tag names are matched without regard to case
  for (const url of jsonLdImages(html, lower)) add(url, "product data");

  const metas = {};
  for (const { tag } of openTags(html, lower, "meta")) {
    const a = attributes(tag);
    const key = (a.property || a.name || "").toLowerCase();
    if (key && a.content && !(key in metas)) metas[key] = a.content;
  }
  for (const key of ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) {
    add(metas[key], "preview image");
  }

  for (const { tag } of openTags(html, lower, "link")) {
    const a = attributes(tag);
    if ((a.rel || "").toLowerCase() === "image_src") add(a.href, "preview image");
  }

  for (const { tag } of openTags(html, lower, "img")) {
    if (candidates.length >= MAX_CANDIDATES) break;
    const a = attributes(tag);
    const src = a.src || a["data-src"];
    if (!src || src.startsWith("data:")) continue;
    if (/sprite|icon|logo|pixel|badge|avatar|flag/i.test(src)) continue;
    const width = Number(a.width);
    if (width && width < 200) continue;
    add(src, "page image");
  }

  const [firstTitle] = openTags(html, lower, "title");
  const titleText = firstTitle ? contentAfter(html, lower, firstTitle.end, "title") : null;
  const title = (metas["og:title"] || decodeEntities(titleText ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

  return { title, candidates };
}

/** Look up a pasted link: either it is a picture, or a page we mine for pictures. */
export async function extractFromUrl(rawUrl, fetchOptions = {}) {
  let res;
  try {
    res = await safeFetch(rawUrl, {
      accept: "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5",
      maxBytes: 4 * 1024 * 1024,
      ...fetchOptions,
    });
  } catch (error) {
    // Many big shops turn away anything that isn't a person's browser.
    if (error instanceof FetchError && [401, 403, 429, 503].includes(error.status)) {
      throw new FetchError(
        "That shop blocks automated visits. Copy the product picture and paste it here instead.",
        "blocked_by_site",
      );
    }
    throw error;
  }

  if (IMAGE_TYPES.has(res.contentType)) {
    return { title: "", candidates: [{ url: res.url, source: "direct image" }] };
  }
  if (!/html/.test(res.contentType)) {
    throw new FetchError("That link isn't a web page or a picture.", "unsupported_type");
  }
  const result = extractFromHtml(res.body.toString("utf8"), res.url);
  if (result.candidates.length === 0) {
    throw new FetchError(
      "Couldn't find a product picture on that page. Copy the picture and paste it instead.",
      "no_images",
    );
  }
  return result;
}

/** Download one picture for the browser, which can't fetch other sites itself. */
export async function fetchImage(rawUrl, fetchOptions = {}) {
  const res = await safeFetch(rawUrl, {
    accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
    maxBytes: 12 * 1024 * 1024,
    ...fetchOptions,
  });
  if (!IMAGE_TYPES.has(res.contentType)) {
    throw new FetchError("That link isn't a picture.", "unsupported_type");
  }
  return { contentType: res.contentType, body: res.body };
}
