import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { extractFromHtml, extractFromUrl, fetchImage } from "../src/extract.js";

const PAGE = `<!doctype html><html><head>
<title>Frog Tee &amp; Friends | Shop</title>
<meta property="og:title" content="Frog Tee">
<meta property="og:image" content="/img/og.jpg?w=1200&amp;h=1200">
<meta name="twitter:image" content="https://cdn.shop.example/tw.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"BreadcrumbList"},
  {"@type":"Product","name":"Frog Tee","image":["https://cdn.shop.example/a.jpg",{"@type":"ImageObject","url":"https://cdn.shop.example/b.jpg"}]}
]}</script>
<script type="application/ld+json">{ this is not json }</script>
</head><body>
<img src="/static/logo.png" width="300">
<img src="/img/tiny.jpg" width="40">
<img data-src="/img/gallery.jpg">
<img src="data:image/png;base64,AAAA">
<img src="/img/drawing.svg">
</body></html>`;

test("product data comes first, then preview images, then page images", () => {
  const { title, candidates } = extractFromHtml(PAGE, "https://shop.example/p/frog-tee");
  assert.equal(title, "Frog Tee");
  assert.deepEqual(candidates, [
    { url: "https://cdn.shop.example/a.jpg", source: "product data" },
    { url: "https://cdn.shop.example/b.jpg", source: "product data" },
    { url: "https://shop.example/img/og.jpg?w=1200&h=1200", source: "preview image" },
    { url: "https://cdn.shop.example/tw.jpg", source: "preview image" },
    { url: "https://shop.example/img/gallery.jpg", source: "page image" },
  ]);
});

test("the page title is used when there is no og:title", () => {
  const { title } = extractFromHtml("<title>  Plain\n Jacket &#39;24 </title>", "https://shop.example/");
  assert.equal(title, "Plain Jacket '24");
});

test("links are looked up over the network", async (t) => {
  const server = http
    .createServer((req, res) => {
      if (req.url === "/product") return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
      if (req.url === "/empty") return res.writeHead(200, { "content-type": "text/html" }).end("<p>nothing</p>");
      if (req.url === "/guarded") return res.writeHead(403, { "content-type": "text/html" }).end("Access Denied");
      if (req.url === "/gone") return res.writeHead(404).end();
      if (req.url === "/shirt.png") return res.writeHead(200, { "content-type": "image/png" }).end("PNGDATA");
      res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF");
    })
    .listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const options = { allowPrivate: true };

  const page = await extractFromUrl(`${origin}/product`, options);
  assert.equal(page.candidates.length, 5);
  assert.equal(page.candidates[2].url, `${origin}/img/og.jpg?w=1200&h=1200`);

  const direct = await extractFromUrl(`${origin}/shirt.png`, options);
  assert.deepEqual(direct.candidates, [{ url: `${origin}/shirt.png`, source: "direct image" }]);

  await assert.rejects(extractFromUrl(`${origin}/empty`, options), (e) => e.code === "no_images");
  await assert.rejects(extractFromUrl(`${origin}/doc.pdf`, options), (e) => e.code === "unsupported_type");

  await assert.rejects(
    extractFromUrl(`${origin}/guarded`, options),
    (e) => e.code === "blocked_by_site" && /paste it here/.test(e.message),
  );
  await assert.rejects(extractFromUrl(`${origin}/gone`, options), (e) => e.code === "bad_status");

  const image = await fetchImage(`${origin}/shirt.png`, options);
  assert.equal(image.contentType, "image/png");
  assert.equal(image.body.toString(), "PNGDATA");
  await assert.rejects(fetchImage(`${origin}/product`, options), (e) => e.code === "unsupported_type");
});
