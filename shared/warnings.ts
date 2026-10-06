import type { ExtractedRecipe, RecipeWarning } from "./recipe";

// Deterministic post-processing applied after the extractor and verifier in every
// runtime (local server, in-browser BYOK, hosted Worker). The models are good but not
// reliable run to run; these rules make the cheap, checkable parts exact.

/** "to taste", "optional", … — no amount is expected, so no missing-amount warning. */
const NO_AMOUNT_NEEDED = /\b(to taste|optional|as needed|for (garnish|serving|topping)|if (you )?(like|want|have))\b/i;

/** Lowercased words of a phrase, with simple plural endings removed ("eggs" → "egg"). */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("es") && /(ch|sh|s|x|z|o)es$/.test(w) ? w.slice(0, -2) : w))
    .map((w) => (w.length > 2 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** Cleans extraction quirks that don't need a model to fix. */
export function normalizeExtractedRecipe(recipe: ExtractedRecipe): ExtractedRecipe {
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ing) => {
      // "Inferred" means the amount was never said, so a number here was invented (seen
      // with Haiku: "3 cups cold cooked rice"). Never show an invented quantity.
      if (ing.confidence === "inferred" && ing.quantity !== null) {
        return { ...ing, quantity: null, unit: null };
      }
      // "4 eggs eggs": a unit that just repeats the item isn't a unit.
      if (ing.unit && words(ing.unit).join(" ") === words(ing.item).join(" ")) {
        return { ...ing, unit: null };
      }
      return ing;
    }),
  };
}

/**
 * Every ingredient without an amount gets a warning unless one already targets it or no
 * amount is expected ("to taste"). The models' own warnings carry a suggested amount and
 * take precedence. Covers "stated" too: models sometimes label an ingredient stated even
 * though no amount was ever said (e.g. "cold rice").
 */
export function ensureAmountWarnings(
  recipe: ExtractedRecipe,
  warnings: RecipeWarning[],
): RecipeWarning[] {
  const added: RecipeWarning[] = [];
  recipe.ingredients.forEach((ing, i) => {
    if (ing.quantity !== null) return;
    if (NO_AMOUNT_NEEDED.test(`${ing.sourceText} ${ing.prep ?? ""}`)) return;
    const target = `ingredients[${i}]`;
    if (warnings.some((w) => w.target === target)) return;
    added.push({
      kind: ing.confidence === "inferred" ? "missing_ingredient" : "vague_quantity",
      message:
        ing.confidence === "inferred"
          ? `No amount was given for ${ing.item}; it's only implied by the method.`
          : ing.confidence === "vague"
            ? `The amount of ${ing.item} is imprecise ("${ing.sourceText}").`
            : `No amount was given for ${ing.item}.`,
      target,
      suggestion: null,
    });
  });
  return [...warnings, ...added];
}

/**
 * Drops "unused ingredient" warnings for ingredients a step plainly mentions — matching the
 * ingredient's main (last) word, so "cooking oil" counts as used by "add two more tablespoons
 * of oil". The verifier occasionally raises these false alarms.
 */
export function dropFalseUnusedWarnings(
  recipe: ExtractedRecipe,
  warnings: RecipeWarning[],
): RecipeWarning[] {
  const stepWords = new Set(recipe.steps.flatMap((s) => words(s.text)));
  return warnings.filter((w) => {
    if (w.kind !== "unused_ingredient") return true;
    const match = /^ingredients\[(\d+)\]$/.exec(w.target ?? "");
    const ing = match ? recipe.ingredients[Number(match[1])] : undefined;
    if (!ing) return true;
    const head = words(ing.item).at(-1);
    return !(head && stepWords.has(head));
  });
}

/** Removes exact duplicates (same kind, target, and message) the verifier sometimes emits. */
export function dedupeWarnings(warnings: RecipeWarning[]): RecipeWarning[] {
  const seen = new Set<string>();
  return warnings.filter((w) => {
    const key = `${w.kind}|${w.target ?? ""}|${w.message.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** All warning post-processing, in order. Use this after the verifier in every runtime. */
export function finalizeWarnings(recipe: ExtractedRecipe, warnings: RecipeWarning[]): RecipeWarning[] {
  return ensureAmountWarnings(recipe, dropFalseUnusedWarnings(recipe, dedupeWarnings(warnings)));
}
