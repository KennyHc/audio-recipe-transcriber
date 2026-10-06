import { describe, expect, it } from "vitest";
import {
  dropFalseUnusedWarnings,
  ensureAmountWarnings,
  finalizeWarnings,
  normalizeExtractedRecipe,
  type ExtractedRecipe,
  type RecipeWarning,
} from "@recipe/shared";

type Ingredient = ExtractedRecipe["ingredients"][number];

function ing(overrides: Partial<Ingredient>): Ingredient {
  return { quantity: null, unit: null, item: "salt", prep: null, sourceText: "", timestamp: null, confidence: "stated", ...overrides };
}

function recipe(ingredients: Ingredient[], stepTexts: string[] = []): ExtractedRecipe {
  return {
    title: "Egg Fried Rice",
    description: null,
    servings: 4,
    totalTimeMinutes: null,
    ingredients,
    steps: stepTexts.map((text) => ({ text, timestamp: null, durationMinutes: null, temperature: null })),
    tips: [],
  };
}

const unused = (i: number): RecipeWarning => ({ kind: "unused_ingredient", message: "Never used.", target: `ingredients[${i}]`, suggestion: null });

describe("ensureAmountWarnings", () => {
  it("warns about an ingredient labelled 'stated' that has no amount (seen with Haiku: 'cold rice')", () => {
    const out = ensureAmountWarnings(recipe([ing({ item: "cold rice", sourceText: "they need to be cold rice" })]), []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "vague_quantity", target: "ingredients[0]" });
    expect(out[0]!.message).toContain("No amount was given for cold rice");
  });

  it("doesn't warn when no amount is expected", () => {
    const r = recipe([
      ing({ item: "salt and pepper", sourceText: "season with salt and pepper to taste" }),
      ing({ item: "red pepper flakes", prep: "optional", sourceText: "if you have them" }),
      ing({ item: "parsley", sourceText: "for garnish" }),
    ]);
    expect(ensureAmountWarnings(r, [])).toEqual([]);
  });

  it("keeps the model's own warning (which carries a suggestion) instead of adding one", () => {
    const own: RecipeWarning = { kind: "vague_quantity", message: "Glug.", target: "ingredients[0]", suggestion: "~2 tbsp" };
    expect(ensureAmountWarnings(recipe([ing({ item: "olive oil", confidence: "vague" })]), [own])).toEqual([own]);
  });
});

describe("dropFalseUnusedWarnings", () => {
  it("drops 'unused' when a step mentions the ingredient's main word (seen with Haiku: cooking oil)", () => {
    const r = recipe(
      [ing({ item: "cooking oil", quantity: 2, unit: "tablespoons" }), ing({ item: "eggs", quantity: 4 })],
      ["Add two more tablespoons of oil to the wok.", "Pour in the whisked egg."],
    );
    expect(dropFalseUnusedWarnings(r, [unused(0), unused(1)])).toEqual([]);
  });

  it("keeps 'unused' for an ingredient no step mentions", () => {
    const r = recipe([ing({ item: "sesame oil" }), ing({ item: "ginger" })], ["Add the sesame oil."]);
    expect(dropFalseUnusedWarnings(r, [unused(1)])).toEqual([unused(1)]);
  });

  it("leaves other warning kinds alone", () => {
    const conflict: RecipeWarning = { kind: "conflict", message: "180 vs 200.", target: "ingredients[0]", suggestion: null };
    const r = recipe([ing({ item: "oil" })], ["Heat the oil."]);
    expect(dropFalseUnusedWarnings(r, [conflict])).toEqual([conflict]);
  });
});

describe("finalizeWarnings", () => {
  it("merges exact duplicate warnings", () => {
    const dup: RecipeWarning = { kind: "vague_quantity", message: "Salt is a pinch.", target: null, suggestion: null };
    expect(finalizeWarnings(recipe([]), [dup, { ...dup, message: " salt is a pinch. " }])).toHaveLength(1);
  });

  it("drops the false 'unused' warning, then backfills the missing-amount warning", () => {
    const r = recipe([ing({ item: "rice", sourceText: "add the rice" })], ["Add the cold rice."]);
    const out = finalizeWarnings(r, [unused(0)]);
    expect(out.map((w) => w.kind)).toEqual(["vague_quantity"]);
  });
});

describe("normalizeExtractedRecipe", () => {
  it("clears a unit that just repeats the item ('4 eggs eggs')", () => {
    const r = normalizeExtractedRecipe(recipe([ing({ item: "eggs", quantity: 4, unit: "eggs" }), ing({ item: "egg", quantity: 1, unit: "eggs" })]));
    expect(r.ingredients.map((i) => i.unit)).toEqual([null, null]);
  });

  it("drops a quantity on an 'inferred' ingredient (seen with Haiku: invented '3 cups' of rice)", () => {
    const r = normalizeExtractedRecipe(
      recipe([ing({ item: "cold cooked rice", quantity: 3, unit: "cups", confidence: "inferred", sourceText: "cold rice" })]),
    );
    expect(r.ingredients[0]).toMatchObject({ quantity: null, unit: null, confidence: "inferred" });
    // ...and the missing-amount warning then follows automatically.
    expect(finalizeWarnings(r, []).map((w) => w.kind)).toEqual(["missing_ingredient"]);
  });

  it("keeps real units", () => {
    const r = normalizeExtractedRecipe(recipe([ing({ item: "garlic", quantity: 4, unit: "cloves" })]));
    expect(r.ingredients[0]!.unit).toBe("cloves");
  });
});
