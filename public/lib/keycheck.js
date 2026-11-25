// Tells a person straight away whether the key they pasted works, using a
// request that costs nothing: listing the service's models.

const loadSdk = () => import("../vendor/anthropic-sdk.js");

/**
 * @param {"gemini"|"openai"|"openrouter"|"claude"} service
 * @param {string} key
 * @returns {Promise<"ok"|"rejected"|"unknown">} "unknown" when the service couldn't be reached
 */
export async function checkKey(service, key, { fetchImpl, sdk } = {}) {
  try {
    if (service === "claude") {
      const { Anthropic } = sdk ?? (await loadSdk());
      const client = new Anthropic({
        apiKey: key,
        dangerouslyAllowBrowser: true,
        maxRetries: 0,
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      });
      try {
        await client.models.list({ limit: 1 });
        return "ok";
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
          return "rejected";
        }
        return "unknown";
      }
    }

    const send = fetchImpl ?? fetch;
    const bearer = { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) };
    const res =
      service === "gemini"
        ? await send("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
            headers: { "x-goog-api-key": key },
            signal: AbortSignal.timeout(15_000),
          })
        : service === "openrouter"
          ? await send("https://openrouter.ai/api/v1/key", bearer) // describes the key itself; costs nothing
          : await send("https://api.openai.com/v1/models", bearer);
    if (res.ok) return "ok";
    // Google answers 400 for a malformed key and 403 for a disabled one.
    if ([400, 401, 403].includes(res.status)) return "rejected";
    return "unknown";
  } catch {
    return "unknown";
  }
}
