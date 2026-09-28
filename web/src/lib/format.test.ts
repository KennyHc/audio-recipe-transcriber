import { describe, it, expect } from "vitest";
import { formatQuantity, formatDuration, formatUnit } from "./format";

describe("formatQuantity", () => {
  it("formats whole numbers", () => {
    expect(formatQuantity(2)).toBe("2");
    expect(formatQuantity(0)).toBe("0");
  });

  it("formats clean fractions with unicode glyphs", () => {
    expect(formatQuantity(0.5)).toBe("½");
    expect(formatQuantity(1.5)).toBe("1 ½");
    expect(formatQuantity(0.25)).toBe("¼");
  });

  it("returns empty string for null/undefined", () => {
    expect(formatQuantity(null)).toBe("");
    expect(formatQuantity(undefined)).toBe("");
  });
});

describe("formatUnit", () => {
  it("pluralises count-ish word units when quantity > 1", () => {
    expect(formatUnit("clove", 6)).toBe("cloves");
    expect(formatUnit("cup", 2)).toBe("cups");
    expect(formatUnit("can", 3)).toBe("cans");
    expect(formatUnit("slice", 4)).toBe("slices");
    expect(formatUnit("pinch", 2)).toBe("pinches");
    expect(formatUnit("handful", 2)).toBe("handfuls");
    expect(formatUnit("sprig", 3)).toBe("sprigs");
    expect(formatUnit("stalk", 2)).toBe("stalks");
    expect(formatUnit("bunch", 2)).toBe("bunches");
    expect(formatUnit("piece", 5)).toBe("pieces");
  });

  it("keeps singular for quantity of exactly 1", () => {
    expect(formatUnit("cup", 1)).toBe("cup");
    expect(formatUnit("clove", 1)).toBe("clove");
  });

  it("keeps singular for fractional quantities <= 1", () => {
    expect(formatUnit("cup", 0.5)).toBe("cup");
  });

  it("never pluralises abbreviations", () => {
    expect(formatUnit("tbsp", 3)).toBe("tbsp");
    expect(formatUnit("tsp", 2)).toBe("tsp");
    expect(formatUnit("g", 200)).toBe("g");
    expect(formatUnit("ml", 500)).toBe("ml");
    expect(formatUnit("oz", 4)).toBe("oz");
    expect(formatUnit("lb", 2)).toBe("lb");
    expect(formatUnit("kg", 2)).toBe("kg");
    expect(formatUnit("l", 2)).toBe("l");
    expect(formatUnit("fl oz", 3)).toBe("fl oz");
  });

  it("passes through unknown units and null unchanged", () => {
    expect(formatUnit("dash", 5)).toBe("dash");
    expect(formatUnit(null, 5)).toBe(null);
    expect(formatUnit("cup", null)).toBe("cup");
  });
});

describe("formatDuration", () => {
  it("formats whole minutes and hours as before", () => {
    expect(formatDuration(90)).toBe("1 hr 30 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 hr");
    expect(formatDuration(2)).toBe("2 min");
  });

  it("formats sub-minute durations in seconds", () => {
    expect(formatDuration(0.5)).toBe("30 sec");
    expect(formatDuration(0.25)).toBe("15 sec");
  });

  it("formats fractional minutes above 1 as min + sec", () => {
    expect(formatDuration(1.5)).toBe("1 min 30 sec");
  });

  it("returns empty string for null/undefined", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(undefined)).toBe("");
  });

  it("handles zero", () => {
    expect(formatDuration(0)).toBe("0 min");
  });
});
