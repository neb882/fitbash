// Generate an outfit picture, check it against the items, and redo it with the
// check's notes when it falls short. This is the evaluator-optimizer pattern:
// one model produces, a separate one judges, and a hard cap ends the loop.

import { buildPrompt, STYLES, DEFAULT_STYLE } from "./prompt.js";
import { ProviderError } from "./providers/errors.js";

/**
 * Runs the loop and yields progress events for the page:
 *   { type: "generating", attempt }
 *   { type: "image", attempt, image: { mimeType, data } }
 *   { type: "checking", attempt }
 *   { type: "review", attempt, review }
 *   { type: "warning", message }
 *   { type: "done", best, attempts }        best = attempt number to show first
 *
 * Throws ProviderError only when no picture was produced at all.
 */
export async function* runOutfit(request, { provider, critic = null, maxAttempts = 2 }) {
  const style = STYLES[request.style] ? request.style : DEFAULT_STYLE;
  const { aspectRatio } = STYLES[style];
  const images = request.items.map(({ mimeType, data }) => ({ mimeType, data }));
  // An item may carry a smaller `review` copy for the check, which is billed by picture area.
  const checkItems = request.items.map((item) => ({ label: item.label, ...(item.review ?? item) }));

  const attempts = [];
  let feedback = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    yield { type: "generating", attempt };

    let image;
    try {
      image = await provider.generate({
        prompt: buildPrompt({ ...request, style, feedback }),
        images,
        aspectRatio,
      });
    } catch (error) {
      if (attempts.length === 0) throw error;
      // A redo failed, but an earlier picture exists. Keep it.
      const reason = error instanceof ProviderError ? error.message : "The image model failed.";
      yield { type: "warning", message: `The redo didn't work: ${reason}` };
      break;
    }
    yield { type: "image", attempt, image };

    const record = { attempt, review: null };
    attempts.push(record);
    if (!critic) break;

    yield { type: "checking", attempt };
    record.review = await critic.review({ items: checkItems, generated: image, fillGaps: request.fillGaps });
    yield { type: "review", attempt, review: record.review };

    // Stop on a pass, and also when the check couldn't run: without its notes
    // a redo would be a blind reroll.
    if (record.review.status !== "reviewed" || record.review.verdict === "pass") break;
    feedback = record.review.fix || describeProblems(record.review);
  }

  yield { type: "done", best: pickBest(attempts), attempts: attempts.length };
}

function describeProblems(review) {
  const lines = review.items
    .filter((item) => !item.present || !item.faithful)
    .map((item) => `Item ${item.number}: ${item.present ? item.problem || "doesn't match its reference" : "missing"}`);
  if (review.otherProblems) lines.push(review.otherProblems);
  return lines.join("\n");
}

/** First attempt that passed; otherwise the highest score, later attempts winning ties. */
export function pickBest(attempts) {
  const passed = attempts.find((a) => a.review?.status === "reviewed" && a.review.verdict === "pass");
  if (passed) return passed.attempt;
  let best = attempts[attempts.length - 1];
  for (const a of attempts) {
    const score = a.review?.status === "reviewed" ? a.review.score : -1;
    const bestScore = best.review?.status === "reviewed" ? best.review.score : -1;
    if (score > bestScore) best = a;
  }
  return best.attempt;
}
