import { describe, expect, it } from "vitest";
import { MAX_SHOPPING_ITEMS, ShoppingListDoc, type Ingredient, type ShoppingItem } from "@recipe/shared";
import {
  addAmounts,
  addRecipeToList,
  addResultMessage,
  categorize,
  clearAll,
  clearChecked,
  editItem,
  emptyList,
  formatAmount,
  formatItemLine,
  groupForDisplay,
  listToText,
  normalizeItemName,
  parseAmount,
  parseStoredList,
  removeItem,
  singularize,
  toggleItem,
} from "./shopping";

const NOW = new Date("2026-10-10T12:00:00.000Z");

function ing(quantity: number | null, unit: string | null, item: string, prep: string | null = null): Ingredient {
  return { quantity, unit, item, prep, sourceText: "", timestamp: null, confidence: "stated" };
}

let seq = 0;
const makeId = () => `id${++seq}`;

function add(list: ShoppingListDoc, ingredients: Ingredient[], extra: Partial<{ recipeId: string; title: string; isPublic: boolean; scaleFactor: number }> = {}) {
  return addRecipeToList(
    list,
    { recipeId: "recipeAAA1", title: "Egg fried rice", isPublic: false, scaleFactor: 1, ingredients, ...extra },
    { now: NOW, makeId },
  );
}

function item(over: Partial<ShoppingItem>): ShoppingItem {
  return {
    id: over.id ?? makeId(),
    item: "garlic",
    quantity: 1,
    unit: null,
    note: null,
    sources: [],
    checked: false,
    addedAt: NOW.toISOString(),
    ...over,
  };
}

describe("singularize / normalizeItemName", () => {
  it.each([
    ["cloves", "clove"],
    ["tomatoes", "tomato"],
    ["potatoes", "potato"],
    ["berries", "berry"],
    ["bunches", "bunch"],
    ["radishes", "radish"],
    ["eggs", "egg"],
    ["onions", "onion"],
    ["leaves", "leaf"],
    ["asparagus", "asparagus"],
    ["hummus", "hummus"],
    ["molasses", "molasses"],
    ["glass", "glass"],
    ["peas", "pea"],
    ["gas", "gas"], // too short to guess
  ])("%s → %s", (input, expected) => {
    expect(singularize(input)).toBe(expected);
  });

  it("lowercases, trims, collapses spaces and singularizes the last word", () => {
    expect(normalizeItemName("  Cherry   Tomatoes. ")).toBe("cherry tomato");
    expect(normalizeItemName("Garlic Cloves")).toBe("garlic clove");
    expect(normalizeItemName("garlic clove")).toBe("garlic clove");
    expect(normalizeItemName("   ")).toBe("");
  });
});

describe("addAmounts", () => {
  it("adds the same unit, including its plural and long forms", () => {
    expect(addAmounts({ quantity: 2, unit: "clove" }, { quantity: 3, unit: "cloves" })).toEqual({ quantity: 5, unit: "clove" });
    expect(addAmounts({ quantity: 1, unit: "tbsp" }, { quantity: 2, unit: "tablespoons" })).toEqual({ quantity: 3, unit: "tbsp" });
    expect(addAmounts({ quantity: 2, unit: null }, { quantity: 3, unit: null })).toEqual({ quantity: 5, unit: null });
  });

  it("converts within volume, expressed in the larger unit when the total is ≥ 1 of it", () => {
    expect(addAmounts({ quantity: 1, unit: "tbsp" }, { quantity: 3, unit: "tsp" })).toEqual({ quantity: 2, unit: "tbsp" });
    expect(addAmounts({ quantity: 1, unit: "tsp" }, { quantity: 1, unit: "tsp" })).toEqual({ quantity: 2, unit: "tsp" });
    expect(addAmounts({ quantity: 500, unit: "ml" }, { quantity: 1, unit: "l" })).toEqual({ quantity: 1.5, unit: "l" });
  });

  it("stays in the smaller unit when the total is under 1 of the larger", () => {
    expect(addAmounts({ quantity: 1, unit: "tsp" }, { quantity: 0.1, unit: "cup" })).toEqual({ quantity: 5.8, unit: "tsp" });
  });

  it("converts within mass", () => {
    expect(addAmounts({ quantity: 500, unit: "g" }, { quantity: 1, unit: "kg" })).toEqual({ quantity: 1.5, unit: "kg" });
    const lbOz = addAmounts({ quantity: 1, unit: "lb" }, { quantity: 8, unit: "oz" })!;
    expect(lbOz.unit).toBe("lb");
    expect(lbOz.quantity).toBeCloseTo(1.5, 2);
  });

  it("refuses mass vs volume, measured vs count, and different count words", () => {
    expect(addAmounts({ quantity: 200, unit: "g" }, { quantity: 1, unit: "cup" })).toBeNull();
    expect(addAmounts({ quantity: 2, unit: null }, { quantity: 100, unit: "g" })).toBeNull();
    expect(addAmounts({ quantity: 1, unit: "can" }, { quantity: 400, unit: "g" })).toBeNull();
    expect(addAmounts({ quantity: 1, unit: "bunch" }, { quantity: 2, unit: "sprigs" })).toBeNull();
  });
});

describe("addRecipeToList", () => {
  it("adds every ingredient as a new line with its source, at the current scale", () => {
    const r = add(emptyList(NOW), [ing(2, "cloves", "garlic", "minced"), ing(1.5, "cups", "rice"), ing(null, null, "salt")], {
      scaleFactor: 2,
    });
    expect(r).toMatchObject({ added: 3, merged: 0, skipped: 0 });
    expect(r.list.items.map((i) => [i.item, i.quantity, i.unit, i.note])).toEqual([
      ["garlic", 4, "cloves", "minced"],
      ["rice", 3, "cups", null],
      ["salt", null, null, null],
    ]);
    expect(r.list.items[0]!.sources).toEqual([{ recipeId: "recipeAAA1", title: "Egg fried rice", isPublic: false }]);
    expect(r.list.items.every((i) => !i.checked && i.addedAt === NOW.toISOString())).toBe(true);
    expect(r.list.updatedAt).toBe(NOW.toISOString());
    expect(ShoppingListDoc.safeParse(r.list).success).toBe(true);
  });

  it("scales fractional servings without float noise", () => {
    const r = add(emptyList(NOW), [ing(1, "tbsp", "soy sauce")], { scaleFactor: 4 / 3 });
    expect(r.list.items[0]!.quantity).toBe(1.333);
    expect(formatAmount(r.list.items[0]!)).toBe("1 ⅓ tbsp");
  });

  it("ignores a bad scale factor (treats it as 1)", () => {
    const r = add(emptyList(NOW), [ing(2, null, "eggs")], { scaleFactor: Number.NaN });
    expect(r.list.items[0]!.quantity).toBe(2);
  });

  it("merges by normalized name and compatible unit across recipes", () => {
    const first = add(emptyList(NOW), [ing(2, "cloves", "Garlic"), ing(2, null, "tomatoes"), ing(1, "tbsp", "oil")]);
    const second = add(first.list, [ing(3, "clove", "garlic"), ing(1, null, "Tomato"), ing(2, "tsp", "oil")], {
      recipeId: "recipeBBB2",
      title: "Shakshuka",
      isPublic: true,
    });
    expect(second).toMatchObject({ added: 3, merged: 3, skipped: 0 });
    expect(second.list.items).toHaveLength(3);
    const [garlic, tomato, oil] = second.list.items;
    expect([garlic!.item, garlic!.quantity, garlic!.unit]).toEqual(["Garlic", 5, "cloves"]);
    expect([tomato!.quantity, tomato!.unit]).toEqual([3, null]);
    expect(oil!.unit).toBe("tbsp");
    expect(oil!.quantity).toBeCloseTo(1.667, 3);
    expect(garlic!.sources).toEqual([
      { recipeId: "recipeAAA1", title: "Egg fried rice", isPublic: false },
      { recipeId: "recipeBBB2", title: "Shakshuka", isPublic: true },
    ]);
  });

  it("keeps incompatible units on separate lines", () => {
    const first = add(emptyList(NOW), [ing(200, "g", "flour")]);
    const second = add(first.list, [ing(1, "cup", "flour")]);
    expect(second).toMatchObject({ added: 1, merged: 0 });
    expect(second.list.items.map((i) => `${i.quantity} ${i.unit}`)).toEqual(["200 g", "1 cup"]);
  });

  it("merges unspecified with unspecified only", () => {
    const first = add(emptyList(NOW), [ing(null, null, "salt"), ing(1, "tsp", "pepper")]);
    const second = add(first.list, [ing(null, null, "Salt"), ing(null, null, "pepper")]);
    expect(second).toMatchObject({ added: 2, merged: 1 });
    expect(second.list.items.map((i) => [i.item, i.quantity, i.unit])).toEqual([
      ["salt", null, null],
      ["pepper", 1, "tsp"],
      ["pepper", null, null],
    ]);
  });

  it("never merges into checked items", () => {
    const first = add(emptyList(NOW), [ing(2, null, "eggs")]);
    const checked = toggleItem(first.list, first.list.items[0]!.id, NOW);
    const second = add(checked, [ing(3, null, "egg")]);
    expect(second).toMatchObject({ added: 1, merged: 0 });
    expect(second.list.items.map((i) => [i.quantity, i.checked])).toEqual([
      [2, true],
      [3, false],
    ]);
  });

  it("adding the same recipe twice doubles amounts without duplicating the source", () => {
    const first = add(emptyList(NOW), [ing(2, null, "eggs")]);
    const again = add(first.list, [ing(2, null, "eggs")]);
    expect(again.list.items[0]!.quantity).toBe(4);
    expect(again.list.items[0]!.sources).toHaveLength(1);
  });

  it("skips empty item names", () => {
    const r = add(emptyList(NOW), [ing(1, null, "   "), ing(1, null, "lime")]);
    expect(r.added).toBe(1);
    expect(r.list.items).toHaveLength(1);
  });

  it("clips long fields to the contract limits", () => {
    const r = add(emptyList(NOW), [ing(1, "x".repeat(50), "y".repeat(200), "z".repeat(200))], { title: "t".repeat(300) });
    const it0 = r.list.items[0]!;
    expect(it0.item.length).toBe(120);
    expect(it0.unit!.length).toBe(30);
    expect(it0.note!.length).toBe(120);
    expect(it0.sources[0]!.title.length).toBe(200);
    expect(ShoppingListDoc.safeParse(r.list).success).toBe(true);
  });

  it("does not exceed MAX_SHOPPING_ITEMS, but still merges when full", () => {
    const full: ShoppingListDoc = {
      items: Array.from({ length: MAX_SHOPPING_ITEMS }, (_, i) => item({ id: `f${i}`, item: `thing ${i}`, quantity: 1 })),
      updatedAt: NOW.toISOString(),
    };
    const r = add(full, [ing(2, null, "thing 0"), ing(1, null, "new thing"), ing(1, null, "another")]);
    expect(r).toMatchObject({ added: 1, merged: 1, skipped: 2 });
    expect(r.list.items).toHaveLength(MAX_SHOPPING_ITEMS);
    expect(r.list.items[0]!.quantity).toBe(3);
    expect(ShoppingListDoc.safeParse(r.list).success).toBe(true);
  });

  it("fills up to the limit then skips the rest", () => {
    const nearlyFull: ShoppingListDoc = {
      items: Array.from({ length: MAX_SHOPPING_ITEMS - 1 }, (_, i) => item({ id: `f${i}`, item: `thing ${i}` })),
      updatedAt: NOW.toISOString(),
    };
    const r = add(nearlyFull, [ing(1, null, "a"), ing(1, null, "bb"), ing(1, null, "cc")]);
    expect(r).toMatchObject({ added: 1, skipped: 2 });
    expect(r.list.items).toHaveLength(MAX_SHOPPING_ITEMS);
  });

  it("caps sources at 20 per item", () => {
    let list = emptyList(NOW);
    for (let i = 0; i < 25; i++) list = add(list, [ing(1, null, "lemon")], { recipeId: `recipe${i}xx` }).list;
    expect(list.items[0]!.sources).toHaveLength(20);
    expect(list.items[0]!.quantity).toBe(25);
  });

  it("does not mutate the input list", () => {
    const first = add(emptyList(NOW), [ing(1, null, "lemon")]);
    const before = JSON.stringify(first.list);
    add(first.list, [ing(1, null, "lemon")]);
    expect(JSON.stringify(first.list)).toBe(before);
  });
});

describe("addResultMessage", () => {
  it("reports added and merged", () => {
    expect(addResultMessage({ added: 12, merged: 2, skipped: 0 })).toBe("Added 12 items — 2 merged.");
    expect(addResultMessage({ added: 1, merged: 0, skipped: 0 })).toBe("Added 1 item.");
  });
  it("says when the list is full", () => {
    expect(addResultMessage({ added: 3, merged: 0, skipped: 2 })).toMatch(/Added 3 items, but your list is full \(300 items\), so 2 didn't fit/);
    expect(addResultMessage({ added: 0, merged: 0, skipped: 4 })).toMatch(/^Your list is full/);
  });
  it("handles a recipe with no ingredients", () => {
    expect(addResultMessage({ added: 0, merged: 0, skipped: 0 })).toMatch(/no ingredients/);
  });
});

describe("editing", () => {
  const base: ShoppingListDoc = {
    items: [item({ id: "a", item: "garlic", checked: true }), item({ id: "b", item: "rice" }), item({ id: "c", item: "eggs", checked: true })],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("toggles, removes and clears checked", () => {
    expect(toggleItem(base, "b", NOW).items.find((i) => i.id === "b")!.checked).toBe(true);
    expect(removeItem(base, "b", NOW).items.map((i) => i.id)).toEqual(["a", "c"]);
    const cleared = clearChecked(base, NOW);
    expect(cleared.items.map((i) => i.id)).toEqual(["b"]);
    expect(cleared.updatedAt).toBe(NOW.toISOString());
    expect(clearAll(NOW)).toEqual({ items: [], updatedAt: NOW.toISOString() });
  });

  it("edits amount, note and name", () => {
    const next = editItem(base, "b", { amount: "1 1/2 cups", note: "  jasmine  ", item: "Rice" }, NOW);
    expect(next.items[1]).toMatchObject({ quantity: 1.5, unit: "cups", note: "jasmine", item: "Rice" });
    const cleared = editItem(next, "b", { amount: "", note: "", item: "   " }, NOW);
    expect(cleared.items[1]).toMatchObject({ quantity: null, unit: null, note: null, item: "Rice" });
  });
});

describe("parseAmount", () => {
  it.each([
    ["2", 2, null],
    ["1.5 kg", 1.5, "kg"],
    ["1,5 l", 1.5, "l"],
    ["1/2 cup", 0.5, "cup"],
    ["1 1/2 cups", 1.5, "cups"],
    ["1½ tbsp", 1.5, "tbsp"],
    ["½", 0.5, null],
    ["400g", 400, "g"],
    ["2 cloves", 2, "cloves"],
    ["a bunch", null, "a bunch"],
    ["", null, null],
  ] as const)("%s", (text, quantity, unit) => {
    expect(parseAmount(text)).toEqual({ quantity, unit });
  });
});

describe("display", () => {
  it("formats amounts and lines", () => {
    expect(formatAmount({ quantity: 6, unit: "clove" })).toBe("6 cloves");
    expect(formatAmount({ quantity: 0.5, unit: "cup" })).toBe("½ cup");
    expect(formatAmount({ quantity: 3, unit: null })).toBe("3");
    expect(formatAmount({ quantity: null, unit: null })).toBe("");
    expect(formatItemLine(item({ item: "garlic", quantity: 2, unit: "clove", note: "minced" }))).toBe("2 cloves garlic (minced)");
    expect(formatItemLine(item({ item: "salt", quantity: null }))).toBe("salt");
  });

  it.each([
    ["Garlic cloves", "produce"],
    ["spring onions", "produce"],
    ["red bell pepper", "produce"],
    ["black pepper", "spices"],
    ["garlic powder", "spices"],
    ["salt", "spices"],
    ["eggs", "dairy"],
    ["unsalted butter", "dairy"],
    ["peanut butter", "pantry"],
    ["coconut milk", "pantry"],
    ["chicken thighs", "meat"],
    ["prawns", "meat"],
    ["soy sauce", "pantry"],
    ["jasmine rice", "pantry"],
    ["tomatoes", "produce"],
    ["tomato paste", "pantry"],
    ["kitchen twine", "other"],
  ] as const)("categorize(%s) = %s", (name, cat) => {
    expect(categorize(name)).toBe(cat);
  });

  it("groups unchecked items by aisle and puts checked ones last", () => {
    const list: ShoppingListDoc = {
      items: [
        item({ id: "1", item: "salt", quantity: null }),
        item({ id: "2", item: "onion", quantity: 2 }),
        item({ id: "3", item: "eggs", quantity: 4, checked: true }),
        item({ id: "4", item: "garlic", quantity: 3, unit: "clove" }),
        item({ id: "5", item: "twine" }),
      ],
      updatedAt: NOW.toISOString(),
    };
    const { groups, checked } = groupForDisplay(list);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Produce", ["2", "4"]],
      ["Spices", ["1"]],
      ["Other", ["5"]],
    ]);
    expect(checked.map((i) => i.id)).toEqual(["3"]);
    expect(listToText(list)).toBe("Produce:\n- 2 onion\n- 3 cloves garlic\n\nSpices:\n- salt\n\nOther:\n- 1 twine");
  });

  it("copies a single group without a heading, and nothing when all is checked", () => {
    const one: ShoppingListDoc = { items: [item({ item: "onion", quantity: 2 })], updatedAt: NOW.toISOString() };
    expect(listToText(one)).toBe("- 2 onion");
    expect(listToText(toggleItem(one, one.items[0]!.id))).toBe("");
  });
});

describe("parseStoredList", () => {
  it("keeps valid items and drops malformed ones", () => {
    const good = item({ id: "ok" });
    const parsed = parseStoredList({ items: [good, { id: 1 }, null, { ...good, id: "ok2", item: "" }], updatedAt: "x" });
    expect(parsed).toEqual({ items: [good], updatedAt: "x" });
  });
  it("rejects non-lists", () => {
    expect(parseStoredList(null)).toBeNull();
    expect(parseStoredList({ items: "nope" })).toBeNull();
    expect(parseStoredList("[]")).toBeNull();
  });
  it("caps at MAX_SHOPPING_ITEMS", () => {
    const items = Array.from({ length: MAX_SHOPPING_ITEMS + 5 }, (_, i) => item({ id: `i${i}` }));
    expect(parseStoredList({ items, updatedAt: "x" })!.items).toHaveLength(MAX_SHOPPING_ITEMS);
  });
});
