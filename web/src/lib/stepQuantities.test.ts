import { describe, it, expect } from "vitest";
import { scaleStepText, scaleStepTextPlain } from "./stepQuantities";

describe("scaleStepTextPlain", () => {
  it("leaves text identical at scale 1 in the Original unit system", () => {
    const text = "Add two tablespoons of soy sauce, then simmer for 9 minutes at 350 degrees.";
    expect(scaleStepTextPlain(text, 1, "original")).toBe(text);
  });

  it("scales a number word + abbreviation-free unit", () => {
    expect(scaleStepTextPlain("Add two tablespoons of soy sauce.", 2, "original")).toBe(
      "Add 4 tbsp of soy sauce.",
    );
  });

  it("scales a digit + unit", () => {
    expect(scaleStepTextPlain("Add 2 tbsp of soy sauce.", 2, "original")).toBe("Add 4 tbsp of soy sauce.");
  });

  it("converts cup to ml in the metric system", () => {
    expect(scaleStepTextPlain("Add 1 cup of pasta water.", 1, "metric")).toBe("Add 240 ml of pasta water.");
  });

  it("handles 'half a' phrasing and singularizes back down", () => {
    expect(scaleStepTextPlain("Stir in half a cup of cream.", 2, "original")).toBe(
      "Stir in 1 cup of cream.",
    );
  });

  it("handles mixed fractions and converts them", () => {
    expect(scaleStepTextPlain("Pour in 1 1/2 cups of stock.", 1, "metric")).toBe(
      "Pour in 350 ml of stock.",
    );
  });

  it("handles a unicode fraction", () => {
    expect(scaleStepTextPlain("Add ½ cup of sugar.", 2, "original")).toBe("Add 1 cup of sugar.");
  });

  it("handles a decimal quantity", () => {
    expect(scaleStepTextPlain("Add 1.5 tsp of salt.", 2, "original")).toBe("Add 3 tsp of salt.");
  });

  it("scales a countable unit without converting it", () => {
    expect(scaleStepTextPlain("Add 4 cloves of garlic.", 2, "original")).toBe("Add 8 cloves of garlic.");
  });

  it("scales 'a couple of' phrasing", () => {
    expect(scaleStepTextPlain("Add a couple of pinches of salt.", 2, "original")).toBe(
      "Add 4 pinches of salt.",
    );
  });

  it("does not scale a duration ('cook for 9 minutes')", () => {
    expect(scaleStepTextPlain("Cook for 9 minutes.", 2, "original")).toBe("Cook for 9 minutes.");
  });

  it("does not touch step numbering ('Step 2')", () => {
    expect(scaleStepTextPlain("Step 2: preheat the oven.", 2, "metric")).toBe("Step 2: preheat the oven.");
  });

  it("does not touch a vague modifier without a unit ('about a minute')", () => {
    expect(scaleStepTextPlain("Whisk for about a minute.", 2, "original")).toBe("Whisk for about a minute.");
  });

  it("does not touch 'two more' without a unit", () => {
    expect(scaleStepTextPlain("Fold in two more times.", 3, "original")).toBe("Fold in two more times.");
  });

  it("does not touch 'add 2 more' without a unit", () => {
    expect(scaleStepTextPlain("Add 2 more if needed.", 2, "original")).toBe("Add 2 more if needed.");
  });

  it("does not touch 'two more minutes' — 'minutes' is not a unit", () => {
    expect(scaleStepTextPlain("Simmer for two more minutes.", 2, "original")).toBe(
      "Simmer for two more minutes.",
    );
  });

  it("scales a quantity with a 'more' modifier between it and the unit, keeping the modifier", () => {
    expect(scaleStepTextPlain("Add two more tablespoons of oil.", 2, "original")).toBe(
      "Add 4 more tbsp of oil.",
    );
  });

  it("converts a 'more'-modified quantity to metric, keeping the modifier", () => {
    expect(scaleStepTextPlain("Add two more tablespoons of oil.", 1, "metric")).toBe(
      "Add 30 more ml of oil.",
    );
  });

  it("scales a 'heaping' modifier, keeping the modifier", () => {
    expect(scaleStepTextPlain("Stir in a heaping tablespoon of sugar.", 2, "original")).toBe(
      "Stir in 2 heaping tbsp of sugar.",
    );
  });

  it("recognizes the other modifier words (extra, additional, heaped, level, generous, scant, big, small, good)", () => {
    expect(scaleStepTextPlain("Add 1 extra cup of water.", 2, "original")).toBe("Add 2 extra cups of water.");
    expect(scaleStepTextPlain("Add 1 additional clove of garlic.", 2, "original")).toBe(
      "Add 2 additional cloves of garlic.",
    );
    expect(scaleStepTextPlain("Use 1 heaped tsp of baking soda.", 2, "original")).toBe(
      "Use 2 heaped tsp of baking soda.",
    );
    expect(scaleStepTextPlain("Use 1 level tsp of salt.", 2, "original")).toBe("Use 2 level tsp of salt.");
    expect(scaleStepTextPlain("Add a generous pinch of pepper.", 2, "original")).toBe(
      "Add 2 generous pinches of pepper.",
    );
    expect(scaleStepTextPlain("Add a scant cup of flour.", 2, "original")).toBe("Add 2 scant cups of flour.");
    expect(scaleStepTextPlain("Add 1 big pinch of salt.", 2, "original")).toBe("Add 2 big pinches of salt.");
    expect(scaleStepTextPlain("Add 1 small pinch of salt.", 2, "original")).toBe("Add 2 small pinches of salt.");
    expect(scaleStepTextPlain("Add a good pinch of salt.", 2, "original")).toBe("Add 2 good pinches of salt.");
  });

  it("still does not match a modifier word with no unit after it ('two more' alone)", () => {
    expect(scaleStepTextPlain("Fold two more, gently.", 2, "original")).toBe("Fold two more, gently.");
  });

  it("leaves a bare temperature number untouched ('350 degrees')", () => {
    expect(scaleStepTextPlain("Preheat the oven to 350 degrees.", 2, "metric")).toBe(
      "Preheat the oven to 350 degrees.",
    );
  });

  it("leaves a °F temperature untouched (handled by convertTemperatureText instead)", () => {
    expect(scaleStepTextPlain("Preheat the oven to 350°F.", 2, "metric")).toBe("Preheat the oven to 350°F.");
  });

  it("leaves a bare 'NNC' temperature untouched, not confused with the 'c' cup alias", () => {
    expect(scaleStepTextPlain("Preheat the oven to 180C.", 2, "metric")).toBe("Preheat the oven to 180C.");
  });

  it("leaves unit-less ingredient counts alone ('4 eggs')", () => {
    expect(scaleStepTextPlain("Crack 4 eggs into a bowl.", 2, "original")).toBe("Crack 4 eggs into a bowl.");
  });

  it("converts weight units to imperial", () => {
    // 500g ≈ 1.1023 lb; formatQuantity renders that as the nearest eighth ("1 ⅛"), same as
    // the ingredient list would for the same value.
    expect(scaleStepTextPlain("Add 500 g of flour.", 1, "imperial")).toBe("Add 1 ⅛ lb of flour.");
  });

  it("is a no-op when there is nothing to scale or convert", () => {
    const text = "Whisk the eggs until frothy.";
    expect(scaleStepTextPlain(text, 3, "metric")).toBe(text);
  });

  it("handles multiple mentions in the same step", () => {
    expect(scaleStepTextPlain("Add 1 tbsp oil and 2 tsp salt.", 2, "original")).toBe(
      "Add 2 tbsp oil and 4 tsp salt.",
    );
  });
});

describe("scaleStepText (segments)", () => {
  it("returns a single unmarked segment when nothing changes", () => {
    const segments = scaleStepText("Whisk the eggs until frothy.", 1, "original");
    expect(segments).toEqual([{ text: "Whisk the eggs until frothy." }]);
  });

  it("marks only the rewritten span with its original wording", () => {
    const segments = scaleStepText("Add two tablespoons of soy sauce.", 2, "original");
    expect(segments).toEqual([
      { text: "Add " },
      { text: "4 tbsp", original: "two tablespoons" },
      { text: " of soy sauce." },
    ]);
  });

  it("marks multiple spans independently", () => {
    const segments = scaleStepText("Add 1 tbsp oil and 2 tsp salt.", 2, "original");
    expect(segments).toEqual([
      { text: "Add " },
      { text: "2 tbsp", original: "1 tbsp" },
      { text: " oil and " },
      { text: "4 tsp", original: "2 tsp" },
      { text: " salt." },
    ]);
  });
});

describe("rough units (pinch, dash, handful)", () => {
  it("don't scale to fractions", () => {
    expect(scaleStepTextPlain("Add a pinch of salt.", 1.25, "original")).toBe("Add a pinch of salt.");
    expect(scaleStepTextPlain("Add a pinch of salt.", 2, "original")).toBe("Add 2 pinches of salt.");
    expect(scaleStepTextPlain("Add a handful of parsley.", 0.5, "original")).toBe("Add a handful of parsley.");
  });
});
