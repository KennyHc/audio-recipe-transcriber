// Pure helpers for keeping warning targets and ingredient confidence in sync
// with user edits made in EditRecipe. Nothing here touches the network or
// mutates its inputs.

import type { Ingredient, RecipeWarning } from "@recipe/shared";

const TARGET_RE = /^(ingredients|steps)\[(\d+)\]$/;

/**
 * Rewrite each warning's target from its original row index to its new index,
 * based on an `originalIndex` -> `newIndex` map for the given row kind.
 * Warnings whose target row was removed (not present in the map) are dropped.
 * General warnings (target === null) and malformed/unrecognized targets are
 * left untouched.
 */
export function remapWarningTargets(
  warnings: RecipeWarning[],
  indexMap: { ingredients: Map<number, number>; steps: Map<number, number> },
): RecipeWarning[] {
  const result: RecipeWarning[] = [];
  for (const w of warnings) {
    if (w.target === null) {
      result.push(w);
      continue;
    }
    const match = TARGET_RE.exec(w.target.trim());
    if (!match) {
      // Malformed / unrecognized target: leave untouched.
      result.push(w);
      continue;
    }
    const kind = match[1] as "ingredients" | "steps";
    const oldIndex = Number(match[2]);
    const map = kind === "ingredients" ? indexMap.ingredients : indexMap.steps;
    const newIndex = map.get(oldIndex);
    if (newIndex === undefined) {
      // Row was removed: drop the warning.
      continue;
    }
    result.push({ ...w, target: `${kind}[${newIndex}]` });
  }
  return result;
}

/**
 * Build an `originalIndex` -> `newIndex` map from a list of rows that each
 * carry their original index (or null for newly-added rows, which have no
 * original index and so are absent from the map).
 */
export function buildIndexMap(originalIndexes: Array<number | null>): Map<number, number> {
  const map = new Map<number, number>();
  originalIndexes.forEach((orig, newIndex) => {
    if (orig !== null) map.set(orig, newIndex);
  });
  return map;
}

const CONFIDENCE_DROP_KINDS = new Set(["vague_quantity", "missing_ingredient", "unsupported"]);

/**
 * Given the set of *original* ingredient indexes whose quantity/unit/item the
 * user changed during editing, mark those ingredients' confidence as
 * "stated" and drop warnings that target them for kinds that no longer apply
 * once the user has confirmed the value. Warnings targeting untouched
 * ingredients (and warnings of other kinds) are left alone.
 *
 * `warnings` should already have up-to-date (post-remap) targets.
 */
export function applyUserConfirmedIngredients(
  ingredients: Ingredient[],
  warnings: RecipeWarning[],
  editedOriginalIndexes: Set<number>,
  indexMap: Map<number, number>,
): { ingredients: Ingredient[]; warnings: RecipeWarning[] } {
  const editedNewIndexes = new Set<number>();
  for (const orig of editedOriginalIndexes) {
    const newIndex = indexMap.get(orig);
    if (newIndex !== undefined) editedNewIndexes.add(newIndex);
  }

  const nextIngredients = ingredients.map((ing, i) =>
    editedNewIndexes.has(i) ? { ...ing, confidence: "stated" as const } : ing,
  );

  const nextWarnings = warnings.filter((w) => {
    if (w.target === null) return true;
    const match = TARGET_RE.exec(w.target.trim());
    if (!match) return true;
    if (match[1] !== "ingredients") return true;
    const idx = Number(match[2]);
    if (!editedNewIndexes.has(idx)) return true;
    return !CONFIDENCE_DROP_KINDS.has(w.kind);
  });

  return { ingredients: nextIngredients, warnings: nextWarnings };
}
