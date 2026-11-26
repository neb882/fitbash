// Builds the instruction sent to the image model.

export const STYLES = {
  flatlay: {
    label: "Flat lay",
    // Upright, so a top, bottoms and shoes each have room at their true length.
    aspectRatio: "3:4",
    scene:
      "Arrange the pieces as a flat lay, the way an outfit is laid out on a bed: seen from directly above on a plain light background, top above bottoms, shoes beside the lower legs of the bottoms. Leave a strip of bare background around every piece, shoes and outer layers included, so that no piece touches or covers any part of another; make every piece smaller if that is what it takes. Show each piece whole, front side up, laid out straight and at its true length and proportions: none cropped, shortened, folded or turned over.",
  },
  // The two worn looks are a pose and a backdrop, so that a chosen setting can take the backdrop's place.
  mannequin: {
    label: "Mannequin",
    worn: true,
    aspectRatio: "3:4",
    pose: "Dress a plain, faceless shop mannequin in the pieces and show it full length, head to toe, front on,",
    backdrop: "against a plain light studio background",
  },
  model: {
    label: "On a model",
    worn: true,
    aspectRatio: "3:4",
    pose: "Show the pieces worn together by a fashion model in a full-length, head-to-toe studio photo, standing front on",
    backdrop: "against a plain light background",
    // The same pose where the picture is not a studio one.
    elsewhere: "Show the pieces worn together by a fashion model in a full-length, head-to-toe photo, standing front on",
  },
};
for (const look of Object.values(STYLES)) look.scene ??= `${look.pose} ${look.backdrop}.`;

export const DEFAULT_STYLE = "flatlay";

/**
 * What the visitor may say about the picture beyond the look. Each choice is offered only for
 * the looks its options have words for, and its first option, the empty one, says nothing:
 * the picture then comes out as it always did, with the model deciding.
 */
export const CHOICES = [
  {
    name: "wearer",
    label: "Worn by",
    options: {
      "": { label: "Either" },
      woman: { label: "A woman", mannequin: "The mannequin has a woman's figure.", model: "The model is a woman." },
      man: { label: "A man", mannequin: "The mannequin has a man's figure.", model: "The model is a man." },
    },
  },
  {
    name: "build",
    label: "Build",
    options: {
      "": { label: "Any" },
      slim: { label: "Slim", mannequin: "The mannequin has a slim build.", model: "The model has a slim build." },
      average: { label: "Average", mannequin: "The mannequin has an average build.", model: "The model has an average, everyday build." },
      plus: { label: "Plus-size", mannequin: "The mannequin is a plus-size one.", model: "The model is plus-size." },
    },
  },
  {
    name: "place",
    label: "Setting",
    // These take the place of the look's plain backdrop instead of adding a sentence.
    backdrop: true,
    options: {
      "": { label: "Plain studio" },
      street: { label: "City street", model: "in a city street in daylight, the street softly out of focus so the clothes stay the subject" },
      outdoors: { label: "Outdoors", model: "outdoors in a park in daylight, the greenery softly out of focus so the clothes stay the subject" },
    },
  },
];


/** Whether a choice has anything to offer for a look. */
export const choiceApplies = (choice, look) => Object.values(choice.options).some((option) => look in option);

// Words in a piece's name that say the outfit already has bottoms, or shoes. English only: a piece with no
// name, or a name these don't know, simply leaves the instruction as it was.
const BOTTOMS =
  /\b(jeans|trousers|slacks|chinos|joggers|leggings|shorts|skirts?|skorts?|kilts?|culottes|jorts|overalls|dungarees|jumpsuits?|rompers?|playsuits?)\b|pants\b|dress(es)?\b(?! (shirts?|shoes?|pants|trousers|socks))/i;
const SHOES =
  /\b(shoes?|sneakers?|trainers|boots?(?![- ]?cut)|sandals?|heels|loafers?|slippers?|clogs?|pumps|oxfords?|brogues?|mules?|espadrilles?|flip[- ]?flops?|slides|flats|moccasins?|wellies)\b/i;

/** Which of the two basics the page may add are already among the named pieces. */
export function namedBasics(labels) {
  return { bottoms: labels.some((label) => BOTTOMS.test(label ?? "")), shoes: labels.some((label) => SHOES.test(label ?? "")) };
}

/**
 * The sentence that lets the model add a missing basic, naming only what can be missing, or "" when the
 * named pieces already include both bottoms and shoes.
 *
 * Measured on the local models (docs/reports/WO-05.md, WO-06.md): told it may add "bottoms or shoes" to a
 * flat lay that had both, the model drew plain trousers or a second kind of shoes in 5 pictures of 6, and
 * with only shoes missing it drew trousers under the supplied jeans in 1 of 2. Without the sentence: 0 of 10.
 */
function basicsSentence(have) {
  if (have.bottoms && have.shoes) return "";
  const rest = "in a neutral color that suits the rest and understated so the supplied items stay the focus.";
  const nothingElse = (kept) => `Add nothing beyond that: no ${kept}hats, bags, watches, jewellery, belts or other accessories that weren't supplied.`;
  if (have.bottoms) return `If the outfit has no shoes, add them: a plain pair of ordinary shoes, ${rest} ${nothingElse("other bottoms, ")}`;
  if (have.shoes) return `If the outfit has no bottoms, add them: plain full-length trousers, ${rest} ${nothingElse("other shoes, ")}`;
  // The added piece is named outright. Seen with a local model: left to choose "a plain one", it gave
  // a lone shirt shorts with separate lower legs in 4 pictures out of 11.
  return `If the outfit cannot be complete without a piece that is missing (bottoms or shoes), add it: plain full-length trousers, or a plain pair of ordinary shoes, ${rest} ${nothingElse("")}`;
}

/**
 * @param {object} request
 * @param {{label?: string}[]} request.items  one entry per reference picture, in order
 * @param {string} request.style              key of STYLES
 * @param {string} [request.wearer]           and `build`, `place`: one key per entry of CHOICES
 * @param {boolean} request.fillGaps          may the model add basics the user didn't supply
 * @param {string} [request.notes]            free text from the user
 * @param {string} [request.feedback]         what the last attempt got wrong
 */
export function buildPrompt({ items, style, fillGaps, notes, feedback, ...chosen }) {
  const look = STYLES[style] ? style : DEFAULT_STYLE;
  const { worn = false, elsewhere } = STYLES[look];
  // What the visitor chose, for this look only: a flat lay has nobody in it and no setting.
  const said = (choice) => choice.options[chosen[choice.name]]?.[look];
  const place = CHOICES.filter((choice) => choice.backdrop).map(said).find(Boolean);
  const extra = CHOICES.filter((choice) => !choice.backdrop).map(said).filter(Boolean);
  const scene = [place ? `${elsewhere} ${place}.` : STYLES[look].scene, ...extra].join(" ");

  const list = items
    .map((item, i) => `${i + 1}. ${item.label?.trim() || "clothing item"}`)
    .join("\n");

  // Adding basics is offered only for what the named pieces leave open. With bottoms and shoes both
  // named there is nothing to add, and the model is told what it is told when the box is unticked.
  const extras =
    (fillGaps && basicsSentence(namedBasics(items.map((item) => item.label)))) ||
    (worn
      ? "Don't add statement pieces or accessories that aren't in the reference pictures. Where no item was supplied, cover the body with the plainest neutral basics so the figure is fully dressed."
      : "Show only the supplied items. Don't add clothing or accessories that aren't in the reference pictures.");

  const parts = [
    "Create one photorealistic picture of a complete outfit put together from the clothing items in the reference pictures.",
    `The reference pictures, in order:\n${list}`,
    scene,
    [
      // The second sentence: seen with the real service, a shirt given as a mirror selfie came back
      // worn by a model with the face and hair of the man in the selfie.
      "Each reference picture shows one item to include. Use only the item itself: ignore any background, person, hanger, watermark or price tag around it. If a reference picture shows a person wearing the item, take the item only: never copy that person's face, hair, body or pose.",
      "Show every supplied item exactly once.",
      "Keep each item true to its picture: the same colors, cut, fabric, and any print, logo or lettering reproduced as it appears there. People will use this picture to decide whether these exact pieces go together, so a changed print or color makes it useless.",
      "Keep each item's own shape and proportions as well, however unusual. An item that is oversized, extra wide, extra long or exaggerated in its picture stays exactly that large and that shape here: never slim it down, shorten it or turn it into the ordinary version of that kind of item.",
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
