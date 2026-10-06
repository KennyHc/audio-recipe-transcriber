// Pure, deterministic scoring: (Recipe, Rubric) -> CaseScore. No I/O, no LLM
// calls — see rubric.ts for the rubric shape and the matching rules this
// file implements.

import type { Ingredient, Recipe, RecipeWarning } from "@recipe/shared";
import type { ExpectedIngredient, Rubric } from "./rubric.ts";

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface CaseScore {
  checks: Check[];
  passed: number;
  total: number;
  score: number; // 0..1
}

// ---------------------------------------------------------------------------
// Text / word matching helpers
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word containment with plural s/es tolerance: builds a regex from
 * `phrase` (each word boundary-matched, joined by whitespace, trailing
 * "s"/"es" optional on the last word) and tests it against `haystack`.
 */
function wholeWordContains(haystack: string, phrase: string): boolean {
  const words = phrase.trim().split(/\s+/).filter(Boolean).map(escapeRegex);
  if (words.length === 0) return false;
  const pattern = `\\b${words.join("\\s+")}(?:es|s)?\\b`;
  return new RegExp(pattern, "i").test(haystack);
}

/** Does the extracted ingredient's `item` match the expected item or any alias? */
function itemMatches(expected: ExpectedIngredient, extractedItem: string): boolean {
  const names = [expected.item, ...expected.aliases];
  return names.some((name) => wholeWordContains(extractedItem, name));
}

// ---------------------------------------------------------------------------
// Unit normalisation
// ---------------------------------------------------------------------------

const UNIT_GROUPS: string[][] = [
  ["tbsp", "tbsps", "tablespoon", "tablespoons"],
  ["tsp", "tsps", "teaspoon", "teaspoons"],
  ["cup", "cups"],
  ["g", "gram", "grams", "gs"],
  ["kg", "kilogram", "kilograms"],
  ["mg", "milligram", "milligrams"],
  ["clove", "cloves"],
  ["oz", "ounce", "ounces"],
  ["lb", "lbs", "pound", "pounds"],
  ["ml", "milliliter", "milliliters", "millilitre", "millilitres"],
  ["l", "liter", "liters", "litre", "litres"],
  ["pinch", "pinches"],
  ["dash", "dashes"],
  ["slice", "slices"],
  ["piece", "pieces"],
  ["can", "cans"],
  ["stick", "sticks"],
  ["head", "heads"],
  ["bunch", "bunches"],
];

const UNIT_LOOKUP = new Map<string, string>();
for (const group of UNIT_GROUPS) {
  const canonical = group[0];
  for (const variant of group) UNIT_LOOKUP.set(variant, canonical);
}

function normalizeUnit(unit: string | null): string | null {
  if (unit == null) return null;
  const cleaned = unit.trim().toLowerCase();
  if (cleaned === "") return null;
  const known = UNIT_LOOKUP.get(cleaned);
  if (known) return known;
  // Generic plural fallback for units not in the table.
  if (cleaned.endsWith("es")) return cleaned.slice(0, -2);
  if (cleaned.endsWith("s")) return cleaned.slice(0, -1);
  return cleaned;
}

function unitsEqual(expected: string | null, actual: string | null): boolean {
  return normalizeUnit(expected) === normalizeUnit(actual);
}

function quantitiesEqual(expected: number | null, actual: number | null): boolean {
  if (expected === null || actual === null) return expected === actual;
  return Math.abs(expected - actual) <= 0.01;
}

// ---------------------------------------------------------------------------
// Ingredient assignment: greedy, most-specific expectation first.
// ---------------------------------------------------------------------------

function specificityRank(e: ExpectedIngredient): number {
  return e.quantity !== undefined || e.unit !== undefined ? 0 : 1;
}

/** Returns, per expected ingredient index, the assigned extracted ingredient index (or null). */
function assignIngredients(expected: ExpectedIngredient[], extracted: Ingredient[]): (number | null)[] {
  const used = new Set<number>();
  const assignment: (number | null)[] = new Array(expected.length).fill(null);

  const order = expected.map((e, i) => ({ e, i })).sort((a, b) => specificityRank(a.e) - specificityRank(b.e));

  for (const { e, i } of order) {
    const candidates = extracted
      .map((ing, idx) => ({ ing, idx }))
      .filter(({ ing, idx }) => !used.has(idx) && itemMatches(e, ing.item));
    if (candidates.length === 0) continue;

    let chosen = candidates[0];
    if (e.quantity !== undefined || e.unit !== undefined) {
      const exact = candidates.find(
        ({ ing }) =>
          (e.quantity === undefined || quantitiesEqual(e.quantity, ing.quantity)) &&
          (e.unit === undefined || unitsEqual(e.unit, ing.unit)),
      );
      if (exact) chosen = exact;
    }
    used.add(chosen.idx);
    assignment[i] = chosen.idx;
  }

  return assignment;
}

// ---------------------------------------------------------------------------
// Per-ingredient check
// ---------------------------------------------------------------------------

function ingredientCheckName(e: ExpectedIngredient): string {
  const parts: string[] = [];
  if (e.quantity !== undefined) parts.push(e.quantity === null ? "amount not stated" : String(e.quantity));
  if (e.unit !== undefined && e.unit !== null) parts.push(e.unit);
  const suffix = parts.length > 0 ? ` (${parts.join(" ")})` : "";
  return `ingredient: ${e.item}${suffix}`;
}

function checkIngredient(e: ExpectedIngredient, extracted: Ingredient | undefined): Check {
  const name = ingredientCheckName(e);

  if (!extracted) {
    return { name, pass: false, detail: "not found among extracted ingredients" };
  }

  const problems: string[] = [];

  if (e.quantity !== undefined && !quantitiesEqual(e.quantity, extracted.quantity)) {
    problems.push(`quantity expected ${JSON.stringify(e.quantity)}, got ${JSON.stringify(extracted.quantity)}`);
  }
  if (e.unit !== undefined && !unitsEqual(e.unit, extracted.unit)) {
    problems.push(`unit expected ${JSON.stringify(e.unit)}, got ${JSON.stringify(extracted.unit)}`);
  }
  if (e.confidence && !e.confidence.includes(extracted.confidence)) {
    problems.push(`confidence expected one of [${e.confidence.join(", ")}], got "${extracted.confidence}"`);
  }

  if (problems.length > 0) {
    return { name, pass: false, detail: `matched "${extracted.item}" but ${problems.join("; ")}` };
  }
  return { name, pass: true, detail: `matched "${extracted.item}"` };
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

function checkTitle(rubric: Rubric, recipe: Recipe): Check {
  const title = recipe.title.toLowerCase();
  const missing: string[] = [];
  for (const entry of rubric.titleKeywords) {
    const alternatives = entry.split("|");
    const found = alternatives.some((alt) => title.includes(alt.toLowerCase()));
    if (!found) missing.push(entry);
  }
  return missing.length === 0
    ? { name: "title", pass: true, detail: `title "${recipe.title}" contains all keywords` }
    : { name: "title", pass: false, detail: `title "${recipe.title}" missing: ${missing.join(", ")}` };
}

// ---------------------------------------------------------------------------
// Servings
// ---------------------------------------------------------------------------

function checkServings(rubric: Rubric, recipe: Recipe): Check | null {
  if (rubric.servings === undefined) return null;
  const pass = rubric.servings === recipe.servings;
  return {
    name: "servings",
    pass,
    detail: pass
      ? `servings ${JSON.stringify(recipe.servings)} matches`
      : `expected servings ${JSON.stringify(rubric.servings)}, got ${JSON.stringify(recipe.servings)}`,
  };
}

// ---------------------------------------------------------------------------
// Forbidden ingredients
// ---------------------------------------------------------------------------

function checkForbidden(name: string, extracted: Ingredient[]): Check {
  const hit = extracted.find((ing) => wholeWordContains(ing.item, name));
  return hit
    ? { name: `forbidden: ${name}`, pass: false, detail: `unexpectedly present as "${hit.item}"` }
    : { name: `forbidden: ${name}`, pass: true, detail: "correctly absent" };
}

// ---------------------------------------------------------------------------
// Extras ("no unexpected ingredients")
// ---------------------------------------------------------------------------

function checkExtras(
  rubric: Rubric,
  extracted: Ingredient[],
  assignment: (number | null)[],
): Check {
  const used = new Set(assignment.filter((idx): idx is number => idx !== null));
  const matchedExpected = rubric.ingredients.filter((_, i) => assignment[i] !== null);

  const extras: string[] = [];
  extracted.forEach((ing, idx) => {
    if (used.has(idx)) return;
    const isDuplicate = matchedExpected.some((e) => itemMatches(e, ing.item));
    if (!isDuplicate) extras.push(ing.item);
  });

  return extras.length === 0
    ? { name: "no unexpected ingredients", pass: true, detail: "no extras" }
    : { name: "no unexpected ingredients", pass: false, detail: `unexpected: ${extras.join(", ")}` };
}

// ---------------------------------------------------------------------------
// Steps in order
// ---------------------------------------------------------------------------

function checkStepsInOrder(rubric: Rubric, recipe: Recipe): Check {
  const stepTexts = recipe.steps.map((s) => s.text.toLowerCase());
  const indices: number[] = [];
  const missing: string[] = [];

  // Search sequentially: each group must match at or after the previous
  // group's matched step, so a keyword that also appears earlier (e.g.
  // green onions chopped early, then added again at the end) doesn't get
  // matched to that earlier, out-of-order occurrence.
  let cursor = 0;
  for (const group of rubric.stepsInOrder) {
    let idx = -1;
    for (let i = cursor; i < stepTexts.length; i++) {
      if (group.some((kw) => stepTexts[i].includes(kw.toLowerCase()))) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      missing.push(group.join("|"));
    } else {
      indices.push(idx);
      cursor = idx + 1;
    }
  }

  if (missing.length > 0) {
    return { name: "steps in order", pass: false, detail: `no step found (in order) for: ${missing.join(", ")}` };
  }

  return { name: "steps in order", pass: true, detail: `matched steps at indices ${indices.join(", ")}` };
}

// ---------------------------------------------------------------------------
// mustWarnAbout
// ---------------------------------------------------------------------------

function resolveWarningTargetText(warning: RecipeWarning, recipe: Recipe): string {
  const match = /^ingredients\[(\d+)\]$/.exec(warning.target ?? "");
  if (!match) return "";
  const idx = Number(match[1]);
  return recipe.ingredients[idx]?.item ?? "";
}

function checkMustWarnAbout(group: string[], recipe: Recipe): Check {
  const name = `warns about: ${group.join("|")}`;
  const hit = recipe.warnings.find((w) => {
    const haystack = [w.message, w.suggestion ?? "", resolveWarningTargetText(w, recipe)].join(" ").toLowerCase();
    return group.some((kw) => haystack.includes(kw.toLowerCase()));
  });
  return hit
    ? { name, pass: true, detail: `matched warning: "${hit.message}"` }
    : { name, pass: false, detail: "no warning mentions any of these keywords" };
}

function checkMustNotWarn(rule: { kinds: string[]; about: string[] }, recipe: Recipe): Check {
  const name = `no false ${rule.kinds.join("/")} warning about: ${rule.about.join("|")}`;
  const hit = recipe.warnings.find((w) => {
    if (!rule.kinds.includes(w.kind)) return false;
    const haystack = [w.message, w.suggestion ?? "", resolveWarningTargetText(w, recipe)].join(" ").toLowerCase();
    return rule.about.some((kw) => haystack.includes(kw.toLowerCase()));
  });
  return hit
    ? { name, pass: false, detail: `false alarm: [${hit.kind}] "${hit.message}"` }
    : { name, pass: true, detail: "no such warning" };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function scoreRecipe(recipe: Recipe, rubric: Rubric): CaseScore {
  const checks: Check[] = [];

  checks.push(checkTitle(rubric, recipe));

  const servingsCheck = checkServings(rubric, recipe);
  if (servingsCheck) checks.push(servingsCheck);

  const assignment = assignIngredients(rubric.ingredients, recipe.ingredients);
  rubric.ingredients.forEach((e, i) => {
    const extractedIdx = assignment[i];
    const extracted = extractedIdx === null ? undefined : recipe.ingredients[extractedIdx];
    if (e.optional && !extracted) return; // optional + absent: no check emitted
    checks.push(checkIngredient(e, extracted));
  });

  for (const forbidden of rubric.forbiddenIngredients) {
    checks.push(checkForbidden(forbidden, recipe.ingredients));
  }

  checks.push(checkExtras(rubric, recipe.ingredients, assignment));

  checks.push(checkStepsInOrder(rubric, recipe));

  for (const group of rubric.mustWarnAbout) {
    checks.push(checkMustWarnAbout(group, recipe));
  }
  for (const rule of rubric.mustNotWarn) {
    checks.push(checkMustNotWarn(rule, recipe));
  }

  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  const score = total === 0 ? 1 : passed / total;

  return { checks, passed, total, score };
}
