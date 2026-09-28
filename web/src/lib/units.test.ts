import { describe, it, expect } from "vitest";
import { convertQuantity, convertTemperatureText } from "./units";

describe("convertQuantity", () => {
  describe('"original" system', () => {
    it("passes through unchanged", () => {
      const result = convertQuantity(2, "tbsp", "original");
      expect(result).toEqual({ quantity: 2, unit: "tbsp" });
    });

    it("passes through null quantity", () => {
      const result = convertQuantity(null, "tbsp", "original");
      expect(result).toEqual({ quantity: null, unit: "tbsp" });
    });

    it("passes through null unit", () => {
      const result = convertQuantity(2, null, "original");
      expect(result).toEqual({ quantity: 2, unit: null });
    });
  });

  describe("null inputs", () => {
    it("passes through null quantity", () => {
      const result = convertQuantity(null, "cup", "metric");
      expect(result).toEqual({ quantity: null, unit: "cup" });
    });

    it("passes through null unit", () => {
      const result = convertQuantity(2, null, "metric");
      expect(result).toEqual({ quantity: 2, unit: null });
    });
  });

  describe("unknown units", () => {
    it("passes through unknown units like 'clove' unchanged", () => {
      const result = convertQuantity(3, "clove", "metric");
      expect(result).toEqual({ quantity: 3, unit: "clove" });
    });

    it("passes through 'pinch' unchanged", () => {
      const result = convertQuantity(1, "pinch", "imperial");
      expect(result).toEqual({ quantity: 1, unit: "pinch" });
    });
  });

  describe("volume conversions to metric", () => {
    it("converts tbsp to ml", () => {
      const result = convertQuantity(2, "tbsp", "metric");
      expect(result.unit).toBe("ml");
      expect(result.quantity).toBeGreaterThan(0);
    });

    it("converts cups to ml", () => {
      const result = convertQuantity(1, "cup", "metric");
      expect(result.unit).toBe("ml");
      expect(result.quantity).toBeGreaterThan(200);
    });

    it("converts fl oz to ml", () => {
      const result = convertQuantity(8, "fl oz", "metric");
      expect(result.unit).toBe("ml");
      expect(result.quantity).toBeGreaterThan(200);
    });
  });

  describe("weight conversions to metric", () => {
    it("converts g to g (no-op)", () => {
      const result = convertQuantity(100, "g", "metric");
      expect(result.unit).toBe("g");
      expect(result.quantity).toBeCloseTo(100);
    });

    it("converts oz to g", () => {
      const result = convertQuantity(1, "oz", "metric");
      expect(result.unit).toBe("g");
      expect(result.quantity).toBeGreaterThan(20);
    });

    it("converts lb to g (or kg if >= 1 kg)", () => {
      const result = convertQuantity(1, "lb", "metric");
      expect(result.unit).toBe("g");
      expect(result.quantity).toBeGreaterThan(400);

      const threeLbs = convertQuantity(3, "lb", "metric");
      expect(threeLbs.unit).toBe("kg");
    });
  });

  describe("volume conversions to imperial", () => {
    it("converts ml to tsp/tbsp/cup based on magnitude", () => {
      const small = convertQuantity(5, "ml", "imperial");
      expect(["tsp", "tbsp"]).toContain(small.unit);

      const medium = convertQuantity(30, "ml", "imperial");
      expect(["tsp", "tbsp"]).toContain(medium.unit);

      const large = convertQuantity(240, "ml", "imperial");
      expect(large.unit).toBe("cup");
    });

    it("converts liter to cup", () => {
      const result = convertQuantity(1, "l", "imperial");
      expect(result.unit).toBe("cup");
      expect(result.quantity).toBeGreaterThan(4);
    });
  });

  describe("weight conversions to imperial", () => {
    it("converts g to oz", () => {
      const result = convertQuantity(100, "g", "imperial");
      expect(result.unit).toBe("oz");
      expect(result.quantity).toBeGreaterThan(3);
    });

    it("converts kg to lb", () => {
      const result = convertQuantity(1, "kg", "imperial");
      expect(result.unit).toBe("lb");
      expect(result.quantity).toBeCloseTo(2.2, 1);
    });
  });

  describe("case-insensitive unit matching", () => {
    it("matches units case-insensitively", () => {
      const lower = convertQuantity(1, "tsp", "metric");
      const upper = convertQuantity(1, "TSP", "metric");
      const mixed = convertQuantity(1, "Tsp", "metric");

      expect(lower.unit).toBe("ml");
      expect(upper.unit).toBe("ml");
      expect(mixed.unit).toBe("ml");
    });
  });

  describe("alias support", () => {
    it("converts 'tablespoon' to ml", () => {
      const result = convertQuantity(1, "tablespoon", "metric");
      expect(result.unit).toBe("ml");
    });

    it("converts 'cup' to ml", () => {
      const result = convertQuantity(2, "cup", "metric");
      expect(result.unit).toBe("ml");
    });

    it("converts 'ounce' to g", () => {
      const result = convertQuantity(2, "ounce", "metric");
      expect(result.unit).toBe("g");
    });

    it("converts 'pound' to g (or kg if >= 1 kg)", () => {
      const result = convertQuantity(1, "pound", "metric");
      expect(result.unit).toBe("g");
      expect(result.quantity).toBeGreaterThan(400);
    });
  });
});

describe("convertTemperatureText", () => {
  describe('"original" system', () => {
    it("returns text unchanged", () => {
      const result = convertTemperatureText("Bake at 350°F", "original");
      expect(result).toBe("Bake at 350°F");
    });

    it("returns empty string unchanged", () => {
      const result = convertTemperatureText("", "original");
      expect(result).toBe("");
    });
  });

  describe("temperature detection and conversion", () => {
    it("converts 350°F to Celsius", () => {
      const result = convertTemperatureText("Bake at 350°F", "metric");
      expect(result).toContain("°C");
      expect(result).not.toContain("350");
    });

    it("converts 180°C to Fahrenheit", () => {
      const result = convertTemperatureText("Bake at 180°C", "imperial");
      expect(result).toContain("°F");
      expect(result).not.toContain("180");
    });

    it("handles degree symbol variations", () => {
      const result1 = convertTemperatureText("180 °C", "imperial");
      const result2 = convertTemperatureText("180C", "imperial");

      expect(result1).toContain("°F");
      expect(result2).toContain("°F");
    });

    it("converts written units like 'degrees Fahrenheit'", () => {
      const result = convertTemperatureText("Preheat to 400 degrees Fahrenheit", "metric");
      expect(result).toContain("°C");
    });

    it("converts 'degrees celsius'", () => {
      const result = convertTemperatureText("Set temperature to 200 degrees celsius", "imperial");
      expect(result).toContain("°F");
    });

    it("handles bare 'degrees' by guessing from value", () => {
      const result1 = convertTemperatureText("Set to 350 degrees", "metric");
      expect(result1).toContain("°C"); // 350 assumed to be Fahrenheit

      const result2 = convertTemperatureText("Set to 180 degrees", "imperial");
      expect(result2).toContain("°F"); // 180 assumed to be Celsius
    });

    it("leaves ambiguous temperatures (< 100 degrees) unchanged", () => {
      const result = convertTemperatureText("Add 50 degrees more heat", "metric");
      // This should not convert since 50 is ambiguous
      expect(result).toContain("50");
    });
  });

  describe("unit confusion avoidance", () => {
    it("does not convert 'add 2 c of stock' (c = cups, not Celsius)", () => {
      const result = convertTemperatureText("add 2 c of stock", "metric");
      expect(result).toBe("add 2 c of stock"); // should not have °C
    });

    it("does not convert 'turn 90 degrees' (angle, not temperature)", () => {
      const result = convertTemperatureText("turn 90 degrees", "metric");
      // This might be tricky; the regex will match but it's under 100 so should be skipped
      expect(result).toContain("90");
    });

    it("converts 'bake at 375 degrees F' correctly", () => {
      const result = convertTemperatureText("bake at 375 degrees F", "metric");
      expect(result).toContain("°C");
    });

    it("normalizes already-correct temperatures", () => {
      const result = convertTemperatureText("Set to 200°F", "imperial");
      expect(result).toContain("200°F"); // F is already imperial
    });

    it("normalizes already-correct Celsius", () => {
      const result = convertTemperatureText("Set to 200°C", "metric");
      expect(result).toContain("200°C"); // C is already metric
    });
  });

  describe("multiple temperature mentions", () => {
    it("converts all temperatures in a string", () => {
      const result = convertTemperatureText("Preheat to 350°F, then reduce to 325°F", "metric");
      const matches = (result.match(/°C/g) || []).length;
      expect(matches).toBeGreaterThanOrEqual(2);
    });
  });

  describe("edge cases", () => {
    it("handles negative temperatures", () => {
      const result = convertTemperatureText("-10 degrees", "imperial");
      // Should not match as it's ambiguous temperature
      expect(result).toContain("-10");
    });

    it("handles fractional temperatures", () => {
      const result = convertTemperatureText("Set to 350.5°F", "metric");
      expect(result).toContain("°C");
    });

    it("preserves non-temperature numbers", () => {
      const text = "Mix 500ml of liquid and bake at 350°F";
      const result = convertTemperatureText(text, "metric");
      expect(result).toContain("500ml");
      expect(result).toContain("°C");
    });
  });
});
