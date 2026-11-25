// Past outfits, kept in the visitor's own browser (IndexedDB) so they can be
// compared and reused. Nothing here leaves the browser.
//
// Two stores share an outfit's id: "outfits" holds what the grid shows (the
// picture and a few words about it), and "pieces" holds the item pictures,
// which are only read when someone wants to use them again.

const DB_NAME = "fitbash";
const DB_VERSION = 1;

/** How many outfits are kept. Older ones are dropped to make room. */
export const MAX_OUTFITS = 24;

/** Of the stored ids, the ones to drop so that at most `max` of the newest remain. */
export function idsToDrop(ids, max = MAX_OUTFITS) {
  const oldestFirst = [...ids].sort((a, b) => a - b);
  return oldestFirst.slice(0, Math.max(0, oldestFirst.length - max));
}

/** The line under a past outfit: its named pieces, or how many there were. */
export function describePieces(labels) {
  const named = labels.map((label) => label.trim()).filter(Boolean);
  if (named.length === labels.length && named.length > 0) return named.join(", ");
  const count = `${labels.length} ${labels.length === 1 ? "piece" : "pieces"}`;
  return named.length ? `${named.join(", ")} and ${labels.length - named.length} more` : count;
}

const done = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const finished = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

let database;

function open() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("outfits", { keyPath: "id", autoIncrement: true });
      request.result.createObjectStore("pieces", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("The outfit store is busy in another tab."));
  });
  // A failed open is not remembered, so a later try can succeed.
  database.catch(() => (database = undefined));
  return database;
}

/**
 * Keep an outfit. Resolves to its id.
 * @param {{picture: Blob, labels: string[], style: string, verdict?: string, score?: number}} outfit
 * @param {{label: string, mimeType: string, data: string, review?: object}[]} pieces
 */
export async function saveOutfit(outfit, pieces) {
  const db = await open();
  const tx = db.transaction(["outfits", "pieces"], "readwrite");
  const outfits = tx.objectStore("outfits");
  const id = await done(outfits.add({ ...outfit, createdAt: Date.now() }));
  tx.objectStore("pieces").put({ id, items: pieces });
  for (const old of idsToDrop(await done(outfits.getAllKeys()))) {
    outfits.delete(old);
    tx.objectStore("pieces").delete(old);
  }
  await finished(tx);
  return id;
}

/** Every kept outfit, newest first, without its item pictures. */
export async function listOutfits() {
  const db = await open();
  const all = await done(db.transaction("outfits").objectStore("outfits").getAll());
  return all.sort((a, b) => b.id - a.id);
}

/** The item pictures of one outfit, or [] when it is gone. */
export async function outfitPieces(id) {
  const db = await open();
  const entry = await done(db.transaction("pieces").objectStore("pieces").get(id));
  return entry?.items ?? [];
}

export async function removeOutfit(id) {
  const db = await open();
  const tx = db.transaction(["outfits", "pieces"], "readwrite");
  tx.objectStore("outfits").delete(id);
  tx.objectStore("pieces").delete(id);
  await finished(tx);
}

export async function clearOutfits() {
  const db = await open();
  const tx = db.transaction(["outfits", "pieces"], "readwrite");
  tx.objectStore("outfits").clear();
  tx.objectStore("pieces").clear();
  await finished(tx);
}
