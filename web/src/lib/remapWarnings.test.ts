import { describe, it, expect } from "vitest";
import type { Ingredient, RecipeWarning } from "@recipe/shared";
import {
  remapWarningTargets,
  buildIndexMap,
  applyUserConfirmedIngredients,
} from "./remapWarnings";

function warning(overrides: Partial<RecipeWarning>): RecipeWarning {
  return {
    kind: "other",
    message: "msg",
    target: null,
    suggestion: null,
    ...overrides,
  };
}

function ingredient(overrides: Partial<Ingredient>): Ingredient {
  return {
    quantity: 1,
    unit: "cup",
    item: "flour",
    prep: null,
    sourceText: "1 cup flour",
    timestamp: null,
    confidence: "stated",
    ...overrides,
  };
}

describe("buildIndexMap", () => {
  it("maps original indexes to new positions, skipping nulls (added rows)", () => {
    // originally [0,1,2] reordered/edited to [2, null(new), 0]
    const map = buildIndexMap([2, null, 0]);
    expect(map.get(2)).toBe(0);
    expect(map.get(0)).toBe(2);
    expect(map.has(1)).toBe(false);
    expect(map.size).toBe(2);
  });
});

describe("remapWarningTargets", () => {
  it("rewrites targets after a reorder", () => {
    const warnings = [warning({ target: "ingredients[0]" }), warning({ target: "ingredients[2]" })];
    // row that was at 0 is now at 2; row that was at 2 is now at 0
    const indexMap = buildIndexMap([2, 1, 0]); // ingredients: newIndex -> originalIndex list
    const result = remapWarningTargets(warnings, {
      ingredients: indexMap,
      steps: new Map(),
    });
    expect(result[0].target).toBe("ingredients[2]");
    expect(result[1].target).toBe("ingredients[0]");
  });

  it("drops warnings targeting a removed row", () => {
    const warnings = [warning({ target: "ingredients[1]" })];
    // original row 1 was deleted; remaining rows [0, 2] map to new indexes [0, 1]
    const indexMap = buildIndexMap([0, 2]);
    const result = remapWarningTargets(warnings, { ingredients: indexMap, steps: new Map() });
    expect(result).toHaveLength(0);
  });

  it("rewrites targets when a row is added at the front", () => {
    const warnings = [warning({ target: "ingredients[0]" })];
    // new row inserted at 0 (null = no original index), original row 0 shifts to 1
    const indexMap = buildIndexMap([null, 0]);
    const result = remapWarningTargets(warnings, { ingredients: indexMap, steps: new Map() });
    expect(result[0].target).toBe("ingredients[1]");
  });

  it("leaves general (null target) warnings untouched", () => {
    const warnings = [warning({ target: null, message: "general issue" })];
    const result = remapWarningTargets(warnings, { ingredients: new Map(), steps: new Map() });
    expect(result).toEqual(warnings);
  });

  it("leaves malformed/unrecognized targets untouched", () => {
    const malformed = [
      warning({ target: "ingredients[abc]" }),
      warning({ target: "tips[0]" }),
      warning({ target: "ingredients2" }),
      warning({ target: "" }),
    ];
    const result = remapWarningTargets(malformed, { ingredients: new Map(), steps: new Map() });
    expect(result).toEqual(malformed);
  });

  it("handles steps independently from ingredients", () => {
    const warnings = [warning({ target: "steps[0]" }), warning({ target: "ingredients[0]" })];
    const result = remapWarningTargets(warnings, {
      ingredients: buildIndexMap([null, 0]), // ingredient 0 -> new index 1
      steps: buildIndexMap([null, null, 0]), // step 0 -> new index 2
    });
    expect(result[0].target).toBe("steps[2]");
    expect(result[1].target).toBe("ingredients[1]");
  });
});

describe("applyUserConfirmedIngredients", () => {
  it("sets confidence to stated for edited ingredients", () => {
    const ingredients = [
      ingredient({ item: "garlic", confidence: "vague" }),
      ingredient({ item: "salt", confidence: "inferred" }),
    ];
    const indexMap = buildIndexMap([0, 1]);
    const { ingredients: next } = applyUserConfirmedIngredients(
      ingredients,
      [],
      new Set([0]),
      indexMap,
    );
    expect(next[0].confidence).toBe("stated");
    expect(next[1].confidence).toBe("inferred");
  });

  it("drops vague_quantity/missing_ingredient/unsupported warnings on edited ingredients", () => {
    const ingredients = [ingredient({ item: "garlic" })];
    const warnings = [
      warning({ kind: "vague_quantity", target: "ingredients[0]" }),
      warning({ kind: "missing_ingredient", target: "ingredients[0]" }),
      warning({ kind: "unsupported", target: "ingredients[0]" }),
      warning({ kind: "conflict", target: "ingredients[0]" }),
    ];
    const indexMap = buildIndexMap([0]);
    const { warnings: next } = applyUserConfirmedIngredients(
      ingredients,
      warnings,
      new Set([0]),
      indexMap,
    );
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("conflict");
  });

  it("leaves untouched ingredients and their warnings alone", () => {
    const ingredients = [ingredient({ item: "garlic", confidence: "vague" })];
    const warnings = [warning({ kind: "vague_quantity", target: "ingredients[0]" })];
    const indexMap = buildIndexMap([0]);
    const { ingredients: nextIng, warnings: nextWarn } = applyUserConfirmedIngredients(
      ingredients,
      warnings,
      new Set(), // nothing edited
      indexMap,
    );
    expect(nextIng[0].confidence).toBe("vague");
    expect(nextWarn).toHaveLength(1);
  });

  it("leaves general and unrelated-target warnings untouched", () => {
    const ingredients = [ingredient({}), ingredient({})];
    const warnings = [
      warning({ kind: "vague_quantity", target: null }),
      warning({ kind: "vague_quantity", target: "ingredients[1]" }),
    ];
    const indexMap = buildIndexMap([0, 1]);
    const { warnings: next } = applyUserConfirmedIngredients(
      ingredients,
      warnings,
      new Set([0]),
      indexMap,
    );
    expect(next).toHaveLength(2);
  });
});
