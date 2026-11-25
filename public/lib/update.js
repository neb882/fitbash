// Tells a visitor whose page is already open that a newer version of the site
// is out. The page never reloads itself: the pieces a visitor has added live
// only in the open page.
//
// Each deploy stamps a version into index.html and into sw.js
// (scripts/stamp-version.sh). A new sw.js makes the browser install a new
// service worker, which takes over open pages; a page then asks the worker for
// its version and compares it with its own.

const CHECK_EVERY_MS = 30 * 60_000;

/** This page's version, or "" for an unstamped copy (local use, tests), which has none to compare. */
export function pageVersion(doc = document) {
  const version = doc.querySelector('meta[name="fitbash-version"]')?.content ?? "";
  return version === "dev" ? "" : version;
}

function workerVersion(worker) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => resolve(event.data?.version ?? "");
    setTimeout(() => resolve(""), 3000);
    worker.postMessage({ type: "version" }, [channel.port2]);
  });
}

/** Start watching. `onNewer` is called when a version other than this page's takes charge. */
export async function watchForUpdates(onNewer) {
  const mine = pageVersion();
  if (!mine || !("serviceWorker" in navigator)) return;

  const compare = async () => {
    const worker = navigator.serviceWorker.controller;
    if (!worker) return;
    const theirs = await workerVersion(worker);
    if (theirs && theirs !== mine) onNewer();
  };
  // A new worker taking over is the moment a newer version became current. That is
  // the only time to compare: a visitor who comes back after an update is handed the
  // new page by the old worker, and for a moment the page is the newer of the two.
  navigator.serviceWorker.addEventListener("controllerchange", compare);

  try {
    const registration = await navigator.serviceWorker.register("sw.js");
    const look = () => registration.update().catch(() => {});
    // A tab left open learns of an update when it is looked at again, and now and then while it stays in view.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") look();
    });
    setInterval(look, CHECK_EVERY_MS);
  } catch {
    // No service worker here (some private windows): the page works, without the notice.
  }
}
