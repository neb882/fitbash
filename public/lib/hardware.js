// Guesses what kind of computer this is, so Setup can suggest a model that fits.
//
// A web page cannot read how much graphics memory a computer has. It can often
// read the graphics card's name, so the guess comes from a table of well-known
// cards and is only ever a suggestion: the person confirms or corrects it.

/** The answers Setup offers, smallest first. */
export const TIERS = {
  small: "A graphics card with up to 10 GB of memory",
  medium: "A graphics card with 12 to 16 GB",
  large: "A graphics card with 20 GB or more",
  apple: "A Mac with an Apple chip (M1 or newer)",
  none: "No separate graphics card, or I'm not sure",
};

// Desktop graphics memory in GB by card name, most specific pattern first.
// Cards sold in two sizes are listed at the smaller one.
const CARDS = [
  // NVIDIA
  [/RTX\s*5090/i, 32],
  [/RTX\s*5080/i, 16],
  [/RTX\s*5070\s*Ti/i, 16],
  [/RTX\s*5070/i, 12],
  [/RTX\s*5060/i, 8],
  [/RTX\s*5050/i, 8],
  [/RTX\s*4090/i, 24],
  [/RTX\s*4080/i, 16],
  [/RTX\s*4070\s*Ti\s*Super/i, 16],
  [/RTX\s*4070/i, 12],
  [/RTX\s*4060/i, 8],
  [/RTX\s*4050/i, 6],
  [/RTX\s*3090/i, 24],
  [/RTX\s*3080\s*Ti/i, 12],
  [/RTX\s*3080/i, 10],
  [/RTX\s*3070/i, 8],
  [/RTX\s*3060\s*Ti/i, 8],
  [/RTX\s*3060/i, 12],
  [/RTX\s*3050/i, 8],
  [/RTX\s*20[6-8]0/i, 8],
  [/GTX\s*1080\s*Ti/i, 11],
  [/GTX\s*1[06]\d0/i, 6],
  // AMD
  [/RX\s*7900\s*XTX/i, 24],
  [/RX\s*7900/i, 20],
  [/RX\s*9070/i, 16],
  [/RX\s*9060/i, 8],
  [/RX\s*7800/i, 16],
  [/RX\s*7700/i, 12],
  [/RX\s*7600\s*XT/i, 16],
  [/RX\s*7600/i, 8],
  [/RX\s*6[89]\d0/i, 16],
  [/RX\s*67\d0/i, 12],
  [/RX\s*6[56]\d0/i, 8],
  // Intel
  [/Arc.*\bA770/i, 8],
  [/Arc.*\bA7[35]0/i, 8],
  [/Arc.*\bB580/i, 12],
  [/Arc.*\bB570/i, 10],
];

// Laptop versions of a card carry less memory than the desktop card of the same name.
const LAPTOP = /laptop|mobile|max-q|notebook/i;

/** Graphics memory in GB for a card name, or null when the card isn't known. */
export function guessMemory(name) {
  const hit = CARDS.find(([pattern]) => pattern.test(name));
  if (!hit) return null;
  const [, desktop] = hit;
  if (!LAPTOP.test(name)) return desktop;
  return desktop >= 24 ? 16 : desktop >= 16 ? 12 : 8;
}

/**
 * The tier a graphics card name suggests, or null when it gives no clue.
 * @param {string} name  as reported by the browser, e.g. "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 ...)"
 */
export function guessTier(name) {
  if (!name) return null;
  if (/Apple\s+M\d/i.test(name)) return "apple";
  const memory = guessMemory(name);
  if (memory !== null) return memory >= 20 ? "large" : memory >= 12 ? "medium" : "small";
  // Graphics built into the processor share the computer's ordinary memory.
  if (/Intel.*(UHD|Iris|HD Graphics)|Radeon(\(TM\))?\s+Graphics|SwiftShader|llvmpipe|Basic Render/i.test(name)) return "none";
  return null;
}

/** A short, readable card name out of the browser's long description. */
export function tidyName(name) {
  const inner = name.match(/ANGLE \([^,]+,\s*([^,]+?)(?:\s+Direct3D\d*.*|\s+\(0x[0-9A-F]+\).*|,.*)?\)?$/i);
  return (inner ? inner[1] : name)
    .replace(/ANGLE Metal Renderer:\s*/i, "")
    .replace(/\(R\)|\(TM\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ask the browser what graphics card it sees. Returns "" when it won't say. */
export async function readGraphicsName() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "";
    if (name) return String(name);
  } catch {
    // Some browsers hide this to resist fingerprinting; try the newer interface.
  }
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    const info = adapter?.info;
    return [info?.vendor, info?.device, info?.description].filter(Boolean).join(" ");
  } catch {
    return "";
  }
}
