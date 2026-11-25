// Stand-in for a real image model: tiles the reference pictures into one SVG.
// Lets the whole app run, and be tested, without an API key.

import { textToBase64 } from "../base64.js";

export function createMockProvider() {
  return {
    name: "mock",
    model: "collage",
    async generate({ images, aspectRatio }) {
      const width = 1024;
      const height = aspectRatio === "3:4" ? 1365 : 1024;
      const cols = Math.ceil(Math.sqrt(images.length));
      const rows = Math.ceil(images.length / cols);
      const gap = 24;
      const cellW = (width - gap * (cols + 1)) / cols;
      const cellH = (height - 96 - gap * (rows + 1)) / rows;

      const tiles = images
        .map((img, i) => {
          const x = gap + (i % cols) * (cellW + gap);
          const y = gap + Math.floor(i / cols) * (cellH + gap);
          return `<image x="${x}" y="${y}" width="${cellW}" height="${cellH}" preserveAspectRatio="xMidYMid meet" href="data:${img.mimeType};base64,${img.data}"/>`;
        })
        .join("");

      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
        `<rect width="100%" height="100%" fill="#f4f1ec"/>${tiles}` +
        `<text x="${width / 2}" y="${height - 40}" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#6b655c">` +
        `Just a collage for now. Finish Setup to get a real outfit picture.</text></svg>`;

      return { mimeType: "image/svg+xml", data: textToBase64(svg) };
    },
  };
}
