/* fitbash service worker. It does two things:
 *
 *   - Serves the site's own files network-first, asking the server every time
 *     (cache: "no-cache"). GitHub Pages lets browsers reuse a file for ten
 *     minutes, so without this a reload just after an update can mix old and
 *     new files, and a page made of two versions may not start. The copy kept
 *     here is used only when the network fails.
 *   - Carries the site's version. Each deploy stamps a new one below, so the
 *     browser installs this file afresh, the new worker takes over open pages,
 *     and a page that was already open can tell its visitor to reload.
 *
 * It never touches requests to other sites (the AI services, a local model).
 * The page registers it only on a stamped copy: scripts/stamp-version.sh.
 */

const VERSION = "dev";
const CACHE_PREFIX = "fitbash-";
const CACHE = `${CACHE_PREFIX}${VERSION}`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// A page asks which version is now in charge, to compare with its own.
self.addEventListener("message", (event) => {
  if (event.data?.type === "version") event.ports[0]?.postMessage({ version: VERSION });
});

// A copy of a response that tells the tab not to reuse it without asking again,
// so a reload goes through this worker instead of the tab's own memory.
function askAgain(request, response) {
  if (request.mode === "navigate" || !response.ok || response.type !== "basic" || response.redirected) return response;
  try {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-cache");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch {
    return response;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Only this site's own files. The local helper's lookups (api/) are live answers, not files.
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;

  event.respondWith(
    fetch(request, { cache: "no-cache" })
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {}));
        }
        return askAgain(request, response);
      })
      .catch(async () => {
        const kept = (await caches.match(request)) ?? (request.mode === "navigate" ? await caches.match("./") : undefined);
        return kept ?? Response.error();
      }),
  );
});
