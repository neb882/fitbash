// Fetches user-supplied URLs without letting them reach private networks.
//
// The app fetches whatever link a visitor pastes, so every connection is
// checked at DNS-resolution time (not before it), which also covers redirects
// and hostnames that resolve to a public address first and a private one later.

import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";
import stream from "node:stream";

export class FetchError extends Error {
  constructor(message, code = "fetch_failed", status) {
    super(message);
    this.name = "FetchError";
    this.code = code;
    this.status = status;
  }
}

const BLOCKED_V4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const BLOCKED_V6 = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
];

const blockList = new net.BlockList();
for (const [addr, prefix] of BLOCKED_V4) blockList.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of BLOCKED_V6) blockList.addSubnet(addr, prefix, "ipv6");

/** True when the address must not be fetched (loopback, private, link-local, ...). */
export function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return blockList.check(address, "ipv4");
  if (family === 6) {
    // IPv4-mapped IPv6 is judged by its IPv4 part, in either spelling:
    // ::ffff:127.0.0.1 or ::ffff:7f00:1.
    const dotted = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (dotted) return blockList.check(dotted[1], "ipv4");
    const hex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return blockList.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, "ipv4");
    }
    return blockList.check(address, "ipv6");
  }
  return true;
}

function guardedLookup(isBlocked, lookup) {
  return (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      // Every answer is checked: a name may resolve to a public and a private address at once.
      if (addresses.some((a) => isBlocked(a.address))) {
        return callback(new FetchError("That address isn't allowed.", "blocked_address"));
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function unzipper(res) {
  const encoding = (res.headers["content-encoding"] || "").toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") return zlib.createGunzip();
  if (encoding === "deflate") return zlib.createInflate();
  if (encoding === "br") return zlib.createBrotliDecompress();
  return null;
}

function requestOnce(url, { isBlocked, lookup, timeoutMs, deadlineMs, maxBytes, accept }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    // A literal IP never goes through lookup, so check it here.
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(literal) && isBlocked(literal)) {
      return reject(new FetchError("That address isn't allowed.", "blocked_address"));
    }

    // Whatever happens first settles the request, once, and stops everything else.
    let settled = false;
    let deadline;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      settle(value);
      req.destroy();
    };
    const fail = (error) => finish(reject, error);

    const req = client.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup(isBlocked, lookup),
        headers: {
          // Shops often reject requests that don't look like a browser.
          "user-agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
          accept,
          "accept-language": "en-US,en;q=0.9",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          return finish(resolve, { redirect: res.headers.location });
        }
        if (status < 200 || status >= 300) {
          return fail(new FetchError(`The site answered with HTTP ${status}.`, "bad_status", status));
        }

        const chunks = [];
        let size = 0;
        const unzip = unzipper(res);
        const body = unzip ?? res;
        // pipeline() carries a broken connection through to the unzipper, which a bare pipe() would not.
        if (unzip) {
          stream.pipeline(res, unzip, (error) => {
            if (error) fail(new FetchError("The download broke off.", "read_failed"));
          });
        } else {
          res.on("error", () => fail(new FetchError("The download broke off.", "read_failed")));
          res.on("aborted", () => fail(new FetchError("The download broke off.", "read_failed")));
        }
        body.on("data", (chunk) => {
          // Counted after unpacking, so a small compressed answer cannot unfold into a huge one.
          size += chunk.length;
          if (size > maxBytes) return fail(new FetchError("That file is too large.", "too_large"));
          chunks.push(chunk);
        });
        body.on("end", () =>
          finish(resolve, {
            status,
            contentType: (res.headers["content-type"] || "").split(";")[0].trim().toLowerCase(),
            body: Buffer.concat(chunks),
          }),
        );
      },
    );

    // Two clocks: one for a site that goes quiet, one for the whole answer, so a
    // site that sends a byte now and then cannot hold the lookup open for ever.
    req.setTimeout(timeoutMs, () => fail(new FetchError("The site took too long to answer.", "timeout")));
    deadline = setTimeout(() => fail(new FetchError("The site took too long to answer.", "timeout")), deadlineMs);
    req.on("error", (err) => fail(err instanceof FetchError ? err : new FetchError("Couldn't reach that site.", "unreachable")));
    req.end();
  });
}

/**
 * GET a public http(s) URL, following up to `maxRedirects` redirects.
 * Returns { url, contentType, body }.
 */
export async function safeFetch(
  rawUrl,
  {
    allowPrivate = false,
    // Which addresses to refuse, and how names are resolved. Tests replace these to stand a
    // local server in for a public one; nothing else should.
    isBlocked = allowPrivate ? () => false : isBlockedAddress,
    lookup = dns.lookup,
    timeoutMs = 10_000,
    deadlineMs = 30_000,
    maxBytes = 5 * 1024 * 1024,
    maxRedirects = 5,
    accept = "*/*",
  } = {},
) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchError("That doesn't look like a link.", "bad_url");
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new FetchError("Only http and https links work.", "bad_url");
    }
    if (url.username || url.password) {
      throw new FetchError("Links with a login in them aren't supported.", "bad_url");
    }
    const result = await requestOnce(url, { isBlocked, lookup, timeoutMs, deadlineMs, maxBytes, accept });
    if (!result.redirect) return { url: url.href, ...result };
    try {
      url = new URL(result.redirect, url);
    } catch {
      throw new FetchError("The site redirected somewhere invalid.", "bad_redirect");
    }
  }
  throw new FetchError("Too many redirects.", "too_many_redirects");
}
