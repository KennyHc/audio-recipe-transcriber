import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Recipe } from "@recipe/shared";
import { scoreRecipe } from "./score.ts";
import { Rubric } from "./rubric.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadRecipe(fixture: string): Promise<Recipe> {
  const raw = await readFile(path.join(__dirname, "__fixtures__", fixture), "utf-8");
  return Recipe.parse(JSON.parse(raw));
}

async function loadRubric(caseDir: string): Promise<Rubric> {
  const raw = await readFile(
    path.join(__dirname, "..", "..", "..", "eval", "cases", caseDir, "expected.json"),
    "utf-8",
  );
  return Rubric.parse(JSON.parse(raw));
}

function failedChecks(score: ReturnType<typeof scoreRecipe>) {
  return score.checks.filter((c) => !c.pass);
}

// ---------------------------------------------------------------------------
// Real fixtures — the lead reviewed these outputs by hand and expects 100%.
// If one of these fails, do NOT loosen the scorer or edit expected.json to
// force a pass: report exactly which check failed and why.
// ---------------------------------------------------------------------------

describe("scoreRecipe against real fixtures", () => {
  it("scores egg-fried-rice.output.json at 100%", async () => {
    const recipe = await loadRecipe("egg-fried-rice.output.json");
    const rubric = await loadRubric("egg-fried-rice");

    const score = scoreRecipe(recipe, rubric);

    expect(failedChecks(score), JSON.stringify(failedChecks(score), null, 2)).toEqual([]);
    expect(score.passed).toBe(score.total);
    expect(score.score).toBe(1);
  });

  it("scores garlic-pasta-messy.output.json at 100%", async () => {
    const recipe = await loadRecipe("garlic-pasta-messy.output.json");
    const rubric = await loadRubric("garlic-pasta-messy");

    const score = scoreRecipe(recipe, rubric);

    expect(failedChecks(score), JSON.stringify(failedChecks(score), null, 2)).toEqual([]);
    expect(score.passed).toBe(score.total);
    expect(score.score).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Synthetic unit tests
// ---------------------------------------------------------------------------

function baseRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    title: "Test Recipe",
    description: null,
    servings: null,
    totalTimeMinutes: null,
    ingredients: [],
    steps: [],
    tips: [],
    warnings: [],
    ...overrides,
  };
}

function ingredient(overrides: Partial<Recipe["ingredients"][number]> = {}): Recipe["ingredients"][number] {
  return {
    quantity: null,
    unit: null,
    item: "salt",
    prep: null,
    sourceText: "",
    timestamp: null,
    confidence: "stated",
    ...overrides,
  };
}

function baseRubric(overrides: Partial<Rubric> = {}): Rubric {
  return {
    description: "test",
    titleKeywords: [],
    ingredients: [],
    forbiddenIngredients: [],
    stepsInOrder: [],
    mustWarnAbout: [],
    mustNotWarn: [],
    ...overrides,
  };
}

describe("scoreRecipe synthetic cases", () => {
  it("matches plurals (egg/eggs)", () => {
    const recipe = baseRecipe({ ingredients: [ingredient({ item: "eggs", quantity: 4 })] });
    const rubric = baseRubric({
      titleKeywords: [],
      ingredients: [{ item: "egg", aliases: [], quantity: 4, optional: false }],
    });
    const score = scoreRecipe(recipe, rubric);
    const check = score.checks.find((c) => c.name.startsWith("ingredient: egg"));
    expect(check?.pass).toBe(true);
  });

  it("matches 'avocado oil' against expected 'oil'", () => {
    const recipe = baseRecipe({ ingredients: [ingredient({ item: "avocado oil", quantity: 1, unit: "tbsp" })] });
    const rubric = baseRubric({
      ingredients: [{ item: "oil", aliases: [], quantity: 1, unit: "tbsp", optional: false }],
    });
    const score = scoreRecipe(recipe, rubric);
    const check = score.checks.find((c) => c.name.startsWith("ingredient: oil"));
    expect(check?.pass).toBe(true);
  });

  it("normalises units (tablespoons -> tbsp)", () => {
    const recipe = baseRecipe({ ingredients: [ingredient({ item: "butter", quantity: 3, unit: "tablespoons" })] });
    const rubric = baseRubric({
      ingredients: [{ item: "butter", aliases: [], quantity: 3, unit: "tbsp", optional: false }],
    });
    const score = scoreRecipe(recipe, rubric);
    const check = score.checks.find((c) => c.name.startsWith("ingredient: butter"));
    expect(check?.pass).toBe(true);
  });

  it("fails when a forbidden ingredient is present", () => {
    const recipe = baseRecipe({ ingredients: [ingredient({ item: "ketchup" })] });
    const rubric = baseRubric({ forbiddenIngredients: ["ketchup"] });
    const score = scoreRecipe(recipe, rubric);
    const check = score.checks.find((c) => c.name === "forbidden: ketchup");
    expect(check?.pass).toBe(false);
  });

  it("fails on wrong quantity", () => {
    const recipe = baseRecipe({ ingredients: [ingredient({ item: "garlic", quantity: 2, unit: "clove" })] });
    const rubric = baseRubric({
      ingredients: [{ item: "garlic", aliases: [], quantity: 4, unit: "clove", optional: false }],
    });
    const score = scoreRecipe(recipe, rubric);
    const check = score.checks.find((c) => c.name.startsWith("ingredient: garlic"));
    expect(check?.pass).toBe(false);
    expect(check?.detail).toMatch(/quantity/);
  });

  it("greedily assigns two 'oil' expectations to the right oil entries (most specific first)", () => {
    const recipe = baseRecipe({
      ingredients: [
        ingredient({ item: "cooking oil", quantity: 2, unit: "tbsp" }),
        ingredient({ item: "avocado oil", quantity: 1, unit: "tbsp" }),
      ],
    });
    const rubric = baseRubric({
      ingredients: [
        { item: "oil", aliases: [], quantity: 1, unit: "tbsp", optional: false },
        { item: "oil", aliases: [], quantity: 2, unit: "tbsp", optional: false },
      ],
    });
    const score = scoreRecipe(recipe, rubric);
    const oilChecks = score.checks.filter((c) => c.name.startsWith("ingredient: oil"));
    expect(oilChecks).toHaveLength(2);
    expect(oilChecks.every((c) => c.pass)).toBe(true);
    // Confirm each matched the correct extracted entry by amount.
    expect(oilChecks.find((c) => c.name.includes("(1 tbsp)"))?.detail).toContain("avocado oil");
    expect(oilChecks.find((c) => c.name.includes("(2 tbsp)"))?.detail).toContain("cooking oil");
    const extras = score.checks.find((c) => c.name === "no unexpected ingredients");
    expect(extras?.pass).toBe(true);
  });

  it("does not count a duplicate salt entry as an extra", () => {
    const recipe = baseRecipe({
      ingredients: [ingredient({ item: "salt" }), ingredient({ item: "salt" })],
    });
    const rubric = baseRubric({
      ingredients: [{ item: "salt", aliases: [], optional: false }],
    });
    const score = scoreRecipe(recipe, rubric);
    const extras = score.checks.find((c) => c.name === "no unexpected ingredients");
    expect(extras?.pass).toBe(true);
  });

  it("fails when steps are out of order", () => {
    const recipe = baseRecipe({
      steps: [
        { text: "Add the green onions and toss.", timestamp: null, durationMinutes: null, temperature: null },
        { text: "Scramble the eggs.", timestamp: null, durationMinutes: null, temperature: null },
      ],
    });
    const rubric = baseRubric({
      stepsInOrder: [["scramble"], ["green onion"]],
    });
    const score = scoreRecipe(recipe, rubric);
    const check = score.checks.find((c) => c.name === "steps in order");
    expect(check?.pass).toBe(false);
  });

  it("matches title keywords with a|b alternatives", () => {
    const recipe = baseRecipe({ title: "Garlic Spaghetti" });
    const rubric = baseRubric({ titleKeywords: ["garlic", "pasta|spaghetti"] });
    const score = scoreRecipe(recipe, rubric);
    const check = score.checks.find((c) => c.name === "title");
    expect(check?.pass).toBe(true);
  });

  it("fails title check when neither alternative is present", () => {
    const recipe = baseRecipe({ title: "Garlic Noodles" });
    const rubric = baseRubric({ titleKeywords: ["garlic", "pasta|spaghetti"] });
    const score = scoreRecipe(recipe, rubric);
    const check = score.checks.find((c) => c.name === "title");
    expect(check?.pass).toBe(false);
  });
});

describe("mustNotWarn (false alarms)", () => {
  const recipe = baseRecipe({
    ingredients: [ingredient({ item: "cooking oil", quantity: 2, unit: "tablespoons" }), ingredient({ item: "salt" })],
    warnings: [
      { kind: "unused_ingredient", message: "Listed but never used in a step.", target: "ingredients[0]", suggestion: null },
      { kind: "vague_quantity", message: "A pinch of salt is imprecise.", target: "ingredients[1]", suggestion: "~1/4 tsp" },
    ],
  });

  it("fails when a forbidden kind of warning targets a matching ingredient", () => {
    const score = scoreRecipe(recipe, baseRubric({ mustNotWarn: [{ kinds: ["unused_ingredient"], about: ["oil"] }] }));
    const check = score.checks.find((c) => c.name.startsWith("no false"));
    expect(check?.pass).toBe(false);
    expect(check?.detail).toContain("unused_ingredient");
  });

  it("ignores other kinds and other ingredients", () => {
    const score = scoreRecipe(
      recipe,
      baseRubric({
        mustNotWarn: [
          { kinds: ["unused_ingredient"], about: ["salt"] }, // salt's warning is vague_quantity, allowed
          { kinds: ["missing_ingredient"], about: ["oil"] },
        ],
      }),
    );
    const falseAlarmChecks = score.checks.filter((c) => c.name.startsWith("no false"));
    expect(falseAlarmChecks).toHaveLength(2);
    expect(falseAlarmChecks.every((c) => c.pass)).toBe(true);
  });
});
