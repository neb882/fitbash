/** An image model call failed. `message` is safe to show in the page. */
export class ProviderError extends Error {
  constructor(message, { status, detail } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Turn a non-2xx response from an image API into a ProviderError.
 * `help` holds plain-language advice for the two setup problems people hit
 * most: { billing, verification }.
 */
export async function errorFromResponse(res, providerName, help = {}) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message ?? JSON.stringify(body).slice(0, 300);
  } catch {
    // Not JSON; the status code is all we have.
  }

  let summary;
  if (help.verification && /verif/i.test(detail)) {
    summary = help.verification;
  } else if (help.billing && (res.status === 429 || res.status === 402) && /quota|billing|credit|free.tier|limit: 0/i.test(detail)) {
    summary = help.billing;
  } else if (res.status === 401 || res.status === 403 || /api key not valid/i.test(detail)) {
    summary = `${providerName} didn't accept your key. Check it in Setup.`;
  } else if (res.status === 429) {
    summary = `${providerName} is getting too many requests from your account right now. Wait a minute and try again.`;
  } else if (res.status === 404) {
    summary = `${providerName} doesn't know the model fitbash asked for. It may have been renamed: see Advanced in Setup.`;
  } else if (res.status >= 500) {
    summary = `${providerName} is having trouble right now. Try again in a minute.`;
  } else {
    summary = `${providerName} couldn't make that picture.`;
  }
  const message = detail ? `${summary} (${providerName} said: ${detail.slice(0, 240)})` : summary;
  return new ProviderError(message, { status: res.status, detail });
}

/** fetch() that reports a dropped connection or a timeout as a ProviderError. */
export async function send(fetchImpl, url, init, providerName) {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? "took too long to answer" : "couldn't be reached";
    throw new ProviderError(`${providerName} ${reason}. Check your connection and try again.`);
  }
}
