import type { ExtractedRecipe, Transcript } from "@recipe/shared";
import { formatTranscriptForPrompt } from "./extractor.ts";

// Re-exported so callers can import both the formatter and the verifier
// prompt from this module; the implementation lives in extractor.ts so the
// transcript-formatting logic has exactly one definition.
export { formatTranscriptForPrompt };

export const VERIFIER_SYSTEM = `You check a structured recipe against the transcript it was extracted from and
report anything that looks wrong. You do not fix the recipe — you only flag
problems for a human to look at.

INPUT
You will be given the transcript (timestamped, as "[t=12.3] text") and the
extracted recipe, with ingredients and steps indexed as they appear in the
recipe: "ingredients[0]", "ingredients[1]", ... and "steps[0]", "steps[1]", ...
Use these exact index-based strings as the \`target\` for any warning
that refers to a specific item.

WHAT TO LOOK FOR — use exactly these kinds:

- missing_ingredient: a step clearly uses something (e.g. "stir in the
  parmesan") that has no corresponding entry in the ingredient list.
- unused_ingredient: an ingredient is listed but never appears in any step —
  it's just sitting there unused.
- conflict: the transcript contains contradictory numbers or instructions
  (e.g. the speaker says "350 degrees" at one point and "375 degrees" at
  another for the same thing) and the recipe only captured one of them, or the
  recipe's value doesn't match what was actually said.
- vague_quantity: an ingredient's amount is imprecise ("a splash", "a
  handful", "some") rather than a number. Put a typical, reasonable amount in
  \`suggestion\` (e.g. "~2 tbsp"), phrased as a suggestion for the cook to
  consider — never as a fact, and it is never applied automatically.
- unsupported: something in the recipe — an ingredient, a quantity, a step —
  that you cannot trace back to anything actually said in the transcript. This
  is your check against hallucination.
- other: anything else worth flagging that doesn't fit the above kinds.

WHAT NOT TO DO
- Don't invent problems to pad the list. If the recipe is a faithful, complete
  representation of the transcript, return an empty warnings array. A short or
  empty list is a correct result, not a lazy one.
- Don't re-litigate stylistic choices (wording, ordering, merged steps) that
  are faithful to the transcript — only flag actual mismatches, omissions, or
  fabrications.
- Every warning's \`message\` should be a short, specific, human-readable
  explanation of the problem, not a repeat of the kind name.`;

/**
 * Formats a recipe's ingredients/steps with their array indices, matching the
 * `ingredients[i]` / `steps[i]` target convention the verifier is asked to use.
 */
export function formatRecipeForPrompt(recipe: ExtractedRecipe): string {
  const ingredients = recipe.ingredients
    .map((ing, i) => {
      const qty = ing.quantity !== null ? `${ing.quantity} ` : "";
      const unit = ing.unit ? `${ing.unit} ` : "";
      const prep = ing.prep ? `, ${ing.prep}` : "";
      return `ingredients[${i}]: ${qty}${unit}${ing.item}${prep} (confidence: ${ing.confidence}; source: "${ing.sourceText}")`;
    })
    .join("\n");

  const steps = recipe.steps
    .map((step, i) => {
      const extras = [
        step.durationMinutes !== null ? `${step.durationMinutes} min` : null,
        step.temperature ?? null,
      ]
        .filter(Boolean)
        .join(", ");
      return `steps[${i}]: ${step.text}${extras ? ` (${extras})` : ""}`;
    })
    .join("\n");

  return [
    `Title: ${recipe.title}`,
    ingredients ? `Ingredients:\n${ingredients}` : "Ingredients: (none)",
    steps ? `Steps:\n${steps}` : "Steps: (none)",
  ].join("\n\n");
}

export function formatVerifierUserMessage(transcript: Transcript, recipe: ExtractedRecipe): string {
  return [
    "TRANSCRIPT:",
    formatTranscriptForPrompt(transcript),
    "",
    "RECIPE:",
    formatRecipeForPrompt(recipe),
  ].join("\n");
}
