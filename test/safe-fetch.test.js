import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { isBlockedAddress, safeFetch, FetchError } from "../src/safe-fetch.js";

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler).listen(0, "127.0.0.1", () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

test("private, loopback and link-local addresses are blocked", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.9",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "not-an-ip",
  ]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test("public addresses are allowed", () => {
  for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test("a local server is refused unless private addresses are allowed", async (t) => {
  const { server, origin } = await serve((req, res) => res.end("hello"));
  t.after(() => server.close());

  await assert.rejects(safeFetch(origin), (error) => error instanceof FetchError && error.code === "blocked_address");
  await assert.rejects(
    safeFetch(origin.replace("127.0.0.1", "localhost")),
    (error) => error instanceof FetchError && error.code === "blocked_address",
  );

  const res = await safeFetch(origin, { allowPrivate: true });
  assert.equal(res.body.toString(), "hello");
});

test("redirects are followed and counted", async (t) => {
  const { server, origin } = await serve((req, res) => {
    if (req.url === "/start") return res.writeHead(302, { location: "/end" }).end();
    if (req.url === "/loop") return res.writeHead(302, { location: "/loop" }).end();
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("arrived");
  });
  t.after(() => server.close());

  const res = await safeFetch(`${origin}/start`, { allowPrivate: true });
  assert.equal(res.url, `${origin}/end`);
  assert.equal(res.contentType, "text/plain");
  assert.equal(res.body.toString(), "arrived");

  await assert.rejects(safeFetch(`${origin}/loop`, { allowPrivate: true }), (e) => e.code === "too_many_redirects");
});

test("a redirect to a non-http scheme is refused", async (t) => {
  const { server, origin } = await serve((req, res) => res.writeHead(302, { location: "file:///etc/passwd" }).end());
  t.after(() => server.close());
  await assert.rejects(safeFetch(origin, { allowPrivate: true }), (e) => e.code === "bad_url");
});

test("oversized bodies, error statuses and odd links are refused", async (t) => {
  const { server, origin } = await serve((req, res) => {
    if (req.url === "/big") return res.end(Buffer.alloc(5000));
    res.writeHead(404).end();
  });
  t.after(() => server.close());

  await assert.rejects(safeFetch(`${origin}/big`, { allowPrivate: true, maxBytes: 1000 }), (e) => e.code === "too_large");
  await assert.rejects(safeFetch(`${origin}/missing`, { allowPrivate: true }), (e) => e.code === "bad_status");
  await assert.rejects(safeFetch("ftp://example.com/x"), (e) => e.code === "bad_url");
  await assert.rejects(safeFetch("https://user:pw@example.com/"), (e) => e.code === "bad_url");
  await assert.rejects(safeFetch("nonsense"), (e) => e.code === "bad_url");
});

// ---- the guards, each held by a test that an attack would have to get past ----

import zlib from "node:zlib";

// Lets the local test server through while every other private address stays blocked.
const onlyTestServer = (address) => address !== "127.0.0.1" && isBlockedAddress(address);

test("the private ranges are blocked to their edges, and not beyond", () => {
  for (const address of ["172.16.0.0", "172.31.255.1", "172.31.255.255", "10.255.255.255", "192.168.255.255", "100.127.255.255", "169.254.0.1"]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  for (const address of ["172.15.255.255", "172.32.0.1", "11.0.0.1", "192.169.0.1", "100.128.0.1", "169.255.0.1"]) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test("a redirect is checked like the first address: a public page cannot send the fetch inside", async (t) => {
  const { server, origin } = await serve((req, res) => {
    const port = server.address().port;
    if (req.url === "/to-literal") return res.writeHead(302, { location: `http://127.0.0.2:${port}/secret` }).end();
    if (req.url === "/to-name") return res.writeHead(302, { location: `http://inside.test:${port}/secret` }).end();
    res.end("should never be read");
  });
  t.after(() => server.close());
  const lookup = (hostname, options, callback) => callback(null, [{ address: "10.0.0.5", family: 4 }]);

  // The first hop is allowed here; the second must still be refused.
  await assert.rejects(safeFetch(`${origin}/to-literal`, { isBlocked: onlyTestServer }), (e) => e.code === "blocked_address");
  await assert.rejects(safeFetch(`${origin}/to-name`, { isBlocked: onlyTestServer, lookup }), (e) => e.code === "blocked_address");
});

test("every address a name resolves to is checked, not only the first", async (t) => {
  const { server, origin } = await serve((req, res) => res.end("reached"));
  t.after(() => server.close());
  const port = server.address().port;
  const answers = (list) => (hostname, options, callback) => callback(null, list.map((address) => ({ address, family: 4 })));

  await assert.rejects(
    safeFetch(`http://two-answers.test:${port}/`, { isBlocked: onlyTestServer, lookup: answers(["127.0.0.1", "10.0.0.5"]) }),
    (e) => e.code === "blocked_address",
  );
  // The same name with only the allowed answer goes through, so the refusal above is the second answer's doing.
  const ok = await safeFetch(`http://one-answer.test:${port}/`, { isBlocked: onlyTestServer, lookup: answers(["127.0.0.1"]) });
  assert.equal(ok.body.toString(), "reached");
});

test("a site that never answers, or answers a byte at a time forever, is given up on", async (t) => {
  const open = new Set();
  const { server, origin } = await serve((req, res) => {
    open.add(res);
    if (req.url === "/silent") return; // never answers
    res.writeHead(200, { "content-type": "text/plain" });
    const drip = setInterval(() => res.write("."), 50); // never stalls long enough to look idle
    res.on("close", () => clearInterval(drip));
  });
  t.after(() => {
    for (const res of open) res.destroy();
    server.close();
  });

  const timed = async (url, options) => {
    const start = Date.now();
    const code = await Promise.race([
      safeFetch(url, { allowPrivate: true, ...options }).then(() => "resolved", (e) => e.code),
      new Promise((resolve) => setTimeout(() => resolve("still pending"), 5000)),
    ]);
    return [code, Date.now() - start];
  };
  const [silent, silentMs] = await timed(`${origin}/silent`, { timeoutMs: 300 });
  assert.equal(silent, "timeout");
  assert.ok(silentMs < 2000, `took ${silentMs} ms`);
  const [drip, dripMs] = await timed(`${origin}/drip`, { timeoutMs: 300, deadlineMs: 600 });
  assert.equal(drip, "timeout");
  assert.ok(dripMs < 2500, `took ${dripMs} ms`);
});

test("the size cap counts what a compressed answer unpacks to", async (t) => {
  const bomb = zlib.gzipSync(Buffer.alloc(2_000_000)); // two megabytes of zeros in about two kilobytes
  const { server, origin } = await serve((req, res) => {
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
    res.end(req.url === "/small" ? zlib.gzipSync("hello") : bomb);
  });
  t.after(() => server.close());
  assert.ok(bomb.length < 10_000);
  await assert.rejects(safeFetch(`${origin}/bomb`, { allowPrivate: true, maxBytes: 10_000 }), (e) => e.code === "too_large");
  assert.equal((await safeFetch(`${origin}/small`, { allowPrivate: true, maxBytes: 10_000 })).body.toString(), "hello");
});

test("a compressed answer that breaks off part-way fails instead of hanging", async (t) => {
  const whole = zlib.gzipSync(Buffer.from("x".repeat(50_000)));
  const { server, origin } = await serve((req, res) => {
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
    res.write(whole.subarray(0, 20), () => res.destroy());
  });
  t.after(() => server.close());
  const outcome = await Promise.race([
    safeFetch(origin, { allowPrivate: true, timeoutMs: 1000 }).then(() => "resolved", (e) => e.code),
    new Promise((resolve) => setTimeout(() => resolve("still pending"), 4000)),
  ]);
  assert.match(outcome, /read_failed|timeout|unreachable/);
});
