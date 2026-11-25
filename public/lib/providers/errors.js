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
 * What a service said went wrong, out of whichever wrapping it used: an object
 * with an `error`, a list holding one (Google's picture requests answer this
 * way), an error that is plain text, or something else, which is quoted in brief.
 */
function wordsOf(body) {
  const error = (Array.isArray(body) ? body[0] : body)?.error;
  if (typeof error === "string") return error;
  if (typeof error?.message === "string") return error.message;
  return JSON.stringify(body).slice(0, 300);
}

/**
 * Turn a non-2xx response from an image API into a ProviderError.
 * `help` holds plain-language advice for the two setup problems people hit
 * most: { billing, verification }. `billingWhen` is the wording by which a
 * service's "too many requests" answer is known to be about money and not pace.
 */
export async function errorFromResponse(res, providerName, help = {}) {
  let detail = "";
  try {
    detail = wordsOf(await res.json());
  } catch {
    // Not JSON; the status code is all we have.
  }

  let summary;
  if (help.verification && /verif/i.test(detail)) {
    summary = help.verification;
  } else if (help.billing && (res.status === 429 || res.status === 402) && (help.billingWhen ?? /quota|billing|credit/i).test(detail)) {
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
