// "Connect OpenRouter": the visitor signs in at OpenRouter and approves, and the
// page is handed a key, with nothing to copy and paste. This is OpenRouter's
// documented sign-in for web pages (OAuth with PKCE, 2026-11):
//
//   1. The page makes a random secret (the verifier), keeps it for this tab, and
//      sends the visitor to openrouter.ai/auth with a fingerprint of it.
//   2. OpenRouter sends the visitor back to the page with a one-time code.
//   3. The page trades the code and the secret for a key. Only the tab that
//      started the sign-in holds the secret, so only it can finish.

const AUTH_PAGE = "https://openrouter.ai/auth";
const EXCHANGE = "https://openrouter.ai/api/v1/auth/keys";
const VERIFIER_KEY = "fitbash-openrouter-verifier";

const base64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The fingerprint OpenRouter is given of a verifier: base64url(SHA-256(verifier)). */
export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * Send the visitor to OpenRouter to sign in. `callbackUrl` is where they come
 * back to: this page, without any query. Throws when the tab can't keep the
 * secret (storage switched off), since the sign-in could then never finish.
 */
export async function beginConnect({ callbackUrl, storage = sessionStorage, go = (url) => location.assign(url) }) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  storage.setItem(VERIFIER_KEY, verifier);
  const url = new URL(AUTH_PAGE);
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", await challengeFor(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  go(url.href);
}

/**
 * Finish a sign-in if this page load is the visitor coming back from one.
 * Resolves to the key, or to null when this is an ordinary page load.
 * Throws when a sign-in was under way and could not be finished.
 */
export async function finishConnect({ url = location.href, storage = sessionStorage, fetchImpl = fetch } = {}) {
  const code = new URL(url).searchParams.get("code");
  let verifier = null;
  try {
    verifier = storage.getItem(VERIFIER_KEY);
    storage.removeItem(VERIFIER_KEY); // one use, whatever happens next
  } catch {
    // No storage: there can be no sign-in under way.
  }
  if (!code || !verifier) return null;

  const res = await fetchImpl(EXCHANGE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.key !== "string" || !body.key) throw new Error("OpenRouter did not hand over a key.");
  return body.key;
}
