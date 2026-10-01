import type { ExtractedRecipe, RecipeWarning } from "./recipe";

/**
 * Every vague/inferred ingredient without an amount must be flagged. The verifier
 * usually does this, but not reliably run to run, so it's guaranteed in code; the
 * model's own warnings (which carry a suggested amount) take precedence.
 */
export function ensureAmountWarnings(
  recipe: ExtractedRecipe,
  warnings: RecipeWarning[],
): RecipeWarning[] {
  const added: RecipeWarning[] = [];
  recipe.ingredients.forEach((ing, i) => {
    if (ing.quantity !== null || ing.confidence === "stated") return;
    const target = `ingredients[${i}]`;
    if (warnings.some((w) => w.target === target)) return;
    added.push({
      kind: ing.confidence === "inferred" ? "missing_ingredient" : "vague_quantity",
      message:
        ing.confidence === "inferred"
          ? `No amount was given for ${ing.item}; it's only implied by the method.`
          : `The amount of ${ing.item} is imprecise ("${ing.sourceText}").`,
      target,
      suggestion: null,
    });
  });
  return [...warnings, ...added];
}
