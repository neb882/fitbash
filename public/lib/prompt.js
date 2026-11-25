// Builds the instruction sent to the image model.

export const STYLES = {
  flatlay: {
    label: "Flat lay",
    // Upright, so a top, bottoms and shoes each have room at their true length.
    aspectRatio: "3:4",
    scene:
      "Arrange the pieces as a flat lay, the way an outfit is laid out on a bed: seen from directly above on a plain light background, top above bottoms, shoes below or beside the bottoms. Show each piece whole and at its true length and proportions: none cropped, shortened, folded away or lying on top of another.",
  },
  mannequin: {
    label: "Mannequin",
    aspectRatio: "3:4",
    scene:
      "Dress a plain, faceless shop mannequin in the pieces and show it full length, head to toe, front on, against a plain light studio background.",
  },
  model: {
    label: "On a model",
    aspectRatio: "3:4",
    scene:
      "Show the pieces worn together by a fashion model in a full-length, head-to-toe studio photo, standing front on against a plain light background.",
  },
};

export const DEFAULT_STYLE = "flatlay";

/**
 * @param {object} request
 * @param {{label?: string}[]} request.items  one entry per reference picture, in order
 * @param {string} request.style              key of STYLES
 * @param {boolean} request.fillGaps          may the model add basics the user didn't supply
 * @param {string} [request.notes]            free text from the user
 * @param {string} [request.feedback]         what the last attempt got wrong
 */
export function buildPrompt({ items, style, fillGaps, notes, feedback }) {
  const scene = (STYLES[style] ?? STYLES[DEFAULT_STYLE]).scene;
  const worn = style === "model" || style === "mannequin";

  const list = items
    .map((item, i) => `${i + 1}. ${item.label?.trim() || "clothing item"}`)
    .join("\n");

  const extras = fillGaps
    ? "If the outfit cannot be complete without a piece that is missing (bottoms or shoes), add a plain one in a neutral color that suits the rest, and keep it understated so the supplied items stay the focus. Add nothing beyond that: no hats, bags, watches, jewellery, belts or other accessories that weren't supplied."
    : worn
      ? "Don't add statement pieces or accessories that aren't in the reference pictures. Where no item was supplied, cover the body with the plainest neutral basics so the figure is fully dressed."
      : "Show only the supplied items. Don't add clothing or accessories that aren't in the reference pictures.";

  const parts = [
    "Create one photorealistic picture of a complete outfit put together from the clothing items in the reference pictures.",
    `The reference pictures, in order:\n${list}`,
    scene,
    [
      "Each reference picture shows one item to include. Use only the item itself: ignore any background, person, hanger, watermark or price tag around it.",
      "Show every supplied item exactly once.",
      "Keep each item true to its picture: the same colors, cut, fabric, and any print, logo or lettering reproduced as it appears there. People will use this picture to decide whether these exact pieces go together, so a changed print or color makes it useless.",
      extras,
      "No captions, labels, borders or collage panels in the picture.",
    ].join("\n"),
  ];

  if (notes?.trim()) parts.push(`Styling notes from the person: ${notes.trim()}`);
  if (feedback?.trim()) {
    parts.push(
      `An earlier attempt at this picture was checked against the reference pictures and fell short. Fix these problems this time:\n${feedback.trim()}`,
    );
  }
  return parts.join("\n\n");
}
