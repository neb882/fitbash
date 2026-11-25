import test from "node:test";
import assert from "node:assert/strict";

import { guessMemory, guessTier, tidyName, TIERS } from "../public/lib/hardware.js";

// Strings in the form browsers report them.
const NAMES = {
  rtx4070: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  rtx4070tiSuper: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti SUPER (0x00002705) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  rtx4090: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  rtx4090laptop: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)",
  rtx3060: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  rtx3060ti: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)",
  gtx1660: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)",
  rx7900xtx: "ANGLE (AMD, AMD Radeon RX 7900 XTX Direct3D11 vs_5_0 ps_5_0, D3D11)",
  rx7600: "ANGLE (AMD, AMD Radeon RX 7600 (radeonsi, navi33, LLVM 17.0.6), OpenGL 4.6)",
  arcB580: "ANGLE (Intel, Intel(R) Arc(TM) B580 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
  appleM2: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)",
  irisXe: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
  ryzenBuiltIn: "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
  software: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
  unknown: "Mali-G78",
};

test("a known card's memory is looked up, and the more specific name wins", () => {
  assert.equal(guessMemory(NAMES.rtx4070), 12);
  assert.equal(guessMemory(NAMES.rtx4070tiSuper), 16);
  assert.equal(guessMemory(NAMES.rtx3060), 12);
  assert.equal(guessMemory(NAMES.rtx3060ti), 8);
  assert.equal(guessMemory(NAMES.rx7900xtx), 24);
  assert.equal(guessMemory(NAMES.arcB580), 12);
  assert.equal(guessMemory(NAMES.unknown), null);
});

test("a laptop card is counted with less memory than the desktop card of the same name", () => {
  assert.equal(guessMemory(NAMES.rtx4090), 24);
  assert.equal(guessMemory(NAMES.rtx4090laptop), 16);
});

test("a card name suggests a tier, and an unknown one suggests nothing", () => {
  const tiers = Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [key, guessTier(name)]));
  assert.deepEqual(tiers, {
    rtx4070: "medium",
    rtx4070tiSuper: "medium",
    rtx4090: "large",
    rtx4090laptop: "medium",
    rtx3060: "medium",
    rtx3060ti: "small",
    gtx1660: "small",
    rx7900xtx: "large",
    rx7600: "small",
    arcB580: "medium",
    appleM2: "apple",
    irisXe: "none",
    ryzenBuiltIn: "none",
    software: "none",
    unknown: null,
  });
  assert.equal(guessTier(""), null);
  for (const tier of Object.values(tiers)) if (tier) assert.ok(TIERS[tier]);
});

test("the browser's long description is shortened to the card's name", () => {
  assert.equal(tidyName(NAMES.rtx4070), "NVIDIA GeForce RTX 4070");
  assert.equal(tidyName(NAMES.rtx4070tiSuper), "NVIDIA GeForce RTX 4070 Ti SUPER");
  assert.equal(tidyName(NAMES.irisXe), "Intel Iris Xe Graphics");
  assert.equal(tidyName(NAMES.appleM2), "Apple M2 Pro");
  assert.equal(tidyName(NAMES.unknown), "Mali-G78");
});
