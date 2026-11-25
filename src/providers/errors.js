/** An image model call failed. `message` is safe to show in the page. */
export class ProviderError extends Error {
  constructor(message, { status, detail } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.detail = detail;
  }
}

/** Turn a non-2xx response from an image API into a ProviderError. */
export async function errorFromResponse(res, providerName) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message ?? JSON.stringify(body).slice(0, 300);
  } catch {
    // Not JSON; the status code is all we have.
  }
  const summary =
    res.status === 401 || res.status === 403
      ? `${providerName} rejected the API key.`
      : res.status === 429
        ? `${providerName} is rate limiting this key, or it is out of credit. Try again shortly.`
        : res.status >= 500
          ? `${providerName} is having trouble right now. Try again shortly.`
          : `${providerName} couldn't make that picture.`;
  return new ProviderError(detail ? `${summary} (${detail})` : summary, { status: res.status, detail });
}
