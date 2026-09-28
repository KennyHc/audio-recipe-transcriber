import { describe, it, expect } from "vitest";
import type { Ingredient, Step } from "@recipe/shared";
import { ingredientsForStep, stepAudioRange, decideCookRouteAction } from "./cook";

function ing(item: string, overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    quantity: null,
    unit: null,
    item,
    prep: null,
    sourceText: item,
    timestamp: null,
    confidence: "stated",
    ...overrides,
  };
}

function step(text: string, overrides: Partial<Step> = {}): Step {
  return { text, timestamp: null, durationMinutes: null, temperature: null, ...overrides };
}

describe("ingredientsForStep", () => {
  it("matches a plural mention of a singular item", () => {
    const ingredients = [ing("egg")];
    const matches = ingredientsForStep("Crack the eggs into a bowl.", ingredients);
    expect(matches.map((m) => m.ingredient.item)).toEqual(["egg"]);
  });

  it("matches on the last word of a multi-word item", () => {
    const ingredients = [ing("red bell pepper")];
    const matches = ingredientsForStep("Slice the pepper thinly.", ingredients);
    expect(matches.map((m) => m.ingredient.item)).toEqual(["red bell pepper"]);
  });

  it("matches multiple distinct ingredients in one step", () => {
    const ingredients = [ing("garlic"), ing("butter"), ing("onion")];
    const matches = ingredientsForStep("Melt the garlic butter in the pan.", ingredients);
    expect(matches.map((m) => m.ingredient.item).sort()).toEqual(["butter", "garlic"]);
  });

  it("returns each ingredient once even if its word appears more than once", () => {
    const ingredients = [ing("red pepper flakes")];
    const matches = ingredientsForStep("Add the red pepper flakes, a pinch of pepper flakes.", ingredients);
    expect(matches).toHaveLength(1);
  });

  it("preserves ingredient-list order regardless of mention order in text", () => {
    const ingredients = [ing("salt"), ing("pepper"), ing("garlic")];
    const matches = ingredientsForStep("Add garlic, salt, and pepper.", ingredients);
    expect(matches.map((m) => m.ingredient.item)).toEqual(["salt", "pepper", "garlic"]);
  });

  it("does not match unrelated words", () => {
    const ingredients = [ing("carrot")];
    const matches = ingredientsForStep("Preheat the oven to 200 degrees.", ingredients);
    expect(matches).toHaveLength(0);
  });

  it("returns empty array for empty step text", () => {
    expect(ingredientsForStep("", [ing("salt")])).toHaveLength(0);
  });
});

describe("stepAudioRange", () => {
  const steps = [
    step("Step 1", { timestamp: 0 }),
    step("Step 2", { timestamp: null }),
    step("Step 3", { timestamp: 30 }),
    step("Step 4", { timestamp: 90 }),
  ];

  it("uses the next non-null timestamp as the end", () => {
    expect(stepAudioRange(steps, 0, 120)).toEqual({ start: 0, end: 30 });
  });

  it("skips over steps with no timestamp to find the next one", () => {
    // step 1 (index 0) has timestamp 0; the very next step is index 1 (null), so it
    // should look past it to index 2 (30).
    expect(stepAudioRange(steps, 0, 120)).toEqual({ start: 0, end: 30 });
  });

  it("uses the audio duration as the end for the last timestamped step", () => {
    expect(stepAudioRange(steps, 3, 120)).toEqual({ start: 90, end: 120 });
  });

  it("returns null when the step itself has no timestamp", () => {
    expect(stepAudioRange(steps, 1, 120)).toBeNull();
  });

  it("returns null for an out-of-range index", () => {
    expect(stepAudioRange(steps, 99, 120)).toBeNull();
  });
});

describe("decideCookRouteAction", () => {
  it("opens cook mode when the route gains /cook and it wasn't already open", () => {
    expect(decideCookRouteAction({ cookRoute: true, cookOpen: false, hasActiveTimers: false })).toBe("open");
  });

  it("does nothing when the route has /cook and cook mode is already open", () => {
    expect(decideCookRouteAction({ cookRoute: true, cookOpen: true, hasActiveTimers: false })).toBe("noop");
    expect(decideCookRouteAction({ cookRoute: true, cookOpen: true, hasActiveTimers: true })).toBe("noop");
  });

  it("does nothing when the route has no /cook and cook mode was already closed", () => {
    expect(decideCookRouteAction({ cookRoute: false, cookOpen: false, hasActiveTimers: false })).toBe("noop");
    expect(decideCookRouteAction({ cookRoute: false, cookOpen: false, hasActiveTimers: true })).toBe("noop");
  });

  it("closes plainly when the route loses /cook and no timers are active", () => {
    expect(decideCookRouteAction({ cookRoute: false, cookOpen: true, hasActiveTimers: false })).toBe("close");
  });

  it("asks to confirm and restore the hash when the route loses /cook with active timers", () => {
    expect(decideCookRouteAction({ cookRoute: false, cookOpen: true, hasActiveTimers: true })).toBe(
      "confirm-and-restore",
    );
  });
});
