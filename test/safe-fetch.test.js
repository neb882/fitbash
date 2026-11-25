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
