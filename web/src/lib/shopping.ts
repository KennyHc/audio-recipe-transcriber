// Shopping list logic — pure, no storage, no React (storage adapters: backend/shoppingList.ts and
// backend/cloud/shoppingList.ts; contract: shared/shopping.ts).
//
// Adding a recipe puts its ingredients on the list at the servings scale the cook is looking at,
// merging each one into an existing *unchecked* line when it's the same thing:
//   - same item after normalizing (lowercase, trimmed, simple plural → singular on the last word:
//     "Cloves" / "clove", "tomatoes" / "tomato"), and
//   - a compatible amount: both unspecified ("salt, to taste" — stays unspecified), the same unit
//     ("clove"/"cloves", "tbsp"/"tablespoons", or none: "2 eggs" + "3 eggs"), or two measured
//     units of the same kind (mass or volume, via units.ts) — otherwise it gets its own line.
// The list never grows past MAX_SHOPPING_ITEMS; merges still happen when it's full.

import {
  MAX_SHOPPING_ITEMS,
  ShoppingItem,
  type Ingredient,
  type ShoppingListDoc,
  type ShoppingSource,
} from "@recipe/shared";
import { lookupMeasuredUnit } from "./units";
import { formatQuantity, formatUnit, PLURAL_UNITS } from "./format";

const MAX_ITEM_CHARS = 120;
const MAX_UNIT_CHARS = 30;
const MAX_NOTE_CHARS = 120;
const MAX_TITLE_CHARS = 200;
const MAX_SOURCES = 20;

export function emptyList(now: Date = new Date()): ShoppingListDoc {
  return { items: [], updatedAt: now.toISOString() };
}

// ---------------------------------------------------------------------------
// Normalizing names and units
// ---------------------------------------------------------------------------

/** Words that end in "s" but aren't plurals (or whose singular we shouldn't guess). */
const NOT_PLURAL = new Set([
  "asparagus",
  "couscous",
  "hummus",
  "molasses",
  "swiss",
  "citrus",
  "octopus",
  "lettuce",
  "grits",
  "oats",
  "brussels",
  "series",
  "species",
  "chives",
  "anchovies",
]);

/** Simple English plural → singular for one word ("tomatoes" → "tomato", "berries" → "berry"). */
export function singularize(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3 || NOT_PLURAL.has(w)) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("oes")) return w.slice(0, -2);
  if (/(?:ch|sh|ss|x|z)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("ves") && (w.endsWith("leaves") || w.endsWith("loaves") || w.endsWith("halves"))) {
    return `${w.slice(0, -3)}f`;
  }
  if (w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** The merge key for an item name: lowercase, single-spaced, no trailing punctuation, last word
 * singular ("Garlic Cloves" → "garlic clove", "cherry tomatoes" → "cherry tomato"). */
export function normalizeItemName(name: string): string {
  const clean = name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "")
    .trim();
  if (!clean) return "";
  const words = clean.split(" ");
  words[words.length - 1] = singularize(words[words.length - 1]!);
  return words.join(" ");
}

type UnitKey =
  | { kind: "none" }
  | { kind: "measured"; dimension: "volume" | "weight"; toBase: number; canonical: string }
  | { kind: "word"; word: string };

const PLURAL_TO_SINGULAR: Record<string, string> = Object.fromEntries(
  Object.entries(PLURAL_UNITS).map(([singular, plural]) => [plural, singular]),
);

function unitKey(unit: string | null): UnitKey {
  const u = unit?.trim().toLowerCase() ?? "";
  if (!u) return { kind: "none" };
  const measured = lookupMeasuredUnit(u);
  if (measured) return { kind: "measured", dimension: measured.dimension, toBase: measured.toBase, canonical: measured.canonical };
  if (u in PLURAL_TO_SINGULAR) return { kind: "word", word: PLURAL_TO_SINGULAR[u]! };
  return { kind: "word", word: singularize(u) };
}

function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Sums two amounts when their units are compatible; null when they aren't (separate lines).
 * Measured units of the same kind are added in the base unit and expressed in the larger of
 * the two units when the total is at least 1 of it ("1 tbsp" + "3 tsp" → "2 tbsp").
 */
export function addAmounts(
  a: { quantity: number; unit: string | null },
  b: { quantity: number; unit: string | null },
): { quantity: number; unit: string | null } | null {
  const ka = unitKey(a.unit);
  const kb = unitKey(b.unit);
  if (ka.kind === "none" && kb.kind === "none") return { quantity: roundQty(a.quantity + b.quantity), unit: a.unit };
  if (ka.kind === "word" && kb.kind === "word" && ka.word === kb.word) {
    return { quantity: roundQty(a.quantity + b.quantity), unit: a.unit };
  }
  if (ka.kind === "measured" && kb.kind === "measured" && ka.dimension === kb.dimension) {
    if (ka.canonical === kb.canonical) return { quantity: roundQty(a.quantity + b.quantity), unit: a.unit };
    const base = a.quantity * ka.toBase + b.quantity * kb.toBase;
    const [big, small] = ka.toBase >= kb.toBase ? [ka, kb] : [kb, ka];
    const target = base / big.toBase >= 1 ? big : small;
    return { quantity: roundQty(base / target.toBase), unit: target.canonical };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Adding a recipe
// ---------------------------------------------------------------------------

export interface AddRecipeInput {
  recipeId: string;
  title: string;
  isPublic: boolean;
  ingredients: Ingredient[];
  /** The servings scale the cook is looking at (1 = as written). */
  scaleFactor: number;
}

export interface AddRecipeResult {
  list: ShoppingListDoc;
  /** Ingredients now on the list (new lines + merged). */
  added: number;
  /** Of those, how many were merged into an existing line. */
  merged: number;
  /** Ingredients left off because the list is full. */
  skipped: number;
}

function defaultId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replace(/-/g, "").slice(0, 20);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).trimEnd() : s;
}

function withSource(sources: ShoppingSource[], source: ShoppingSource): ShoppingSource[] {
  if (sources.some((s) => s.recipeId === source.recipeId && s.isPublic === source.isPublic)) return sources;
  if (sources.length >= MAX_SOURCES) return sources;
  return [...sources, source];
}

export function addRecipeToList(
  list: ShoppingListDoc,
  input: AddRecipeInput,
  options: { now?: Date; makeId?: () => string } = {},
): AddRecipeResult {
  const now = options.now ?? new Date();
  const makeId = options.makeId ?? defaultId;
  const factor = Number.isFinite(input.scaleFactor) && input.scaleFactor > 0 ? input.scaleFactor : 1;
  const source: ShoppingSource = {
    recipeId: input.recipeId.slice(0, 64),
    title: clip(input.title.trim() || "Untitled recipe", MAX_TITLE_CHARS),
    isPublic: input.isPublic,
  };

  const items = list.items.map((i) => ({ ...i }));
  let added = 0;
  let merged = 0;
  let skipped = 0;

  for (const ing of input.ingredients) {
    const name = clip(ing.item.replace(/\s+/g, " ").trim(), MAX_ITEM_CHARS);
    const key = normalizeItemName(name);
    if (!key) continue;
    const unit = ing.unit?.trim() ? clip(ing.unit.trim(), MAX_UNIT_CHARS) : null;
    const quantity = ing.quantity === null || !Number.isFinite(ing.quantity) ? null : roundQty(ing.quantity * factor);

    let mergedInto = false;
    for (let idx = 0; idx < items.length; idx++) {
      const existing = items[idx]!;
      if (existing.checked || normalizeItemName(existing.item) !== key) continue;
      if (quantity === null || existing.quantity === null) {
        if (quantity !== null || existing.quantity !== null) continue;
        items[idx] = { ...existing, sources: withSource(existing.sources, source) };
        mergedInto = true;
        break;
      }
      const sum = addAmounts({ quantity: existing.quantity, unit: existing.unit }, { quantity, unit });
      if (!sum) continue;
      items[idx] = { ...existing, quantity: sum.quantity, unit: sum.unit, sources: withSource(existing.sources, source) };
      mergedInto = true;
      break;
    }

    if (mergedInto) {
      added++;
      merged++;
      continue;
    }
    if (items.length >= MAX_SHOPPING_ITEMS) {
      skipped++;
      continue;
    }
    const prep = ing.prep?.trim();
    items.push({
      id: makeId(),
      item: name,
      quantity,
      unit,
      note: prep ? clip(prep, MAX_NOTE_CHARS) : null,
      sources: [source],
      checked: false,
      addedAt: now.toISOString(),
    });
    added++;
  }

  return { list: { items, updatedAt: now.toISOString() }, added, merged, skipped };
}

/** "Added 12 items — 2 merged" (and the full-list note when some didn't fit). */
export function addResultMessage(result: Pick<AddRecipeResult, "added" | "merged" | "skipped">): string {
  const { added, merged, skipped } = result;
  const parts: string[] = [];
  if (added === 0 && skipped === 0) return "Nothing to add — this recipe has no ingredients.";
  if (added > 0) {
    parts.push(`Added ${added} item${added === 1 ? "" : "s"}${merged > 0 ? ` — ${merged} merged` : ""}`);
  }
  if (skipped > 0) {
    parts.push(
      `${added > 0 ? "but your" : "Your"} list is full (${MAX_SHOPPING_ITEMS} items), so ${skipped} didn't fit. Clear checked items to make room.`,
    );
  }
  return parts.join(", ") + (skipped > 0 ? "" : ".");
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function touch(items: ShoppingItem[], now: Date): ShoppingListDoc {
  return { items, updatedAt: now.toISOString() };
}

export function toggleItem(list: ShoppingListDoc, id: string, now: Date = new Date()): ShoppingListDoc {
  return touch(
    list.items.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)),
    now,
  );
}

export function removeItem(list: ShoppingListDoc, id: string, now: Date = new Date()): ShoppingListDoc {
  return touch(
    list.items.filter((i) => i.id !== id),
    now,
  );
}

export function clearChecked(list: ShoppingListDoc, now: Date = new Date()): ShoppingListDoc {
  return touch(
    list.items.filter((i) => !i.checked),
    now,
  );
}

export function clearAll(now: Date = new Date()): ShoppingListDoc {
  return emptyList(now);
}

export interface ItemEdit {
  /** Free text like "2 cloves", "1 1/2 cups", "½", or "" for unspecified. */
  amount?: string;
  note?: string;
  item?: string;
}

export function editItem(list: ShoppingListDoc, id: string, edit: ItemEdit, now: Date = new Date()): ShoppingListDoc {
  return touch(
    list.items.map((i) => {
      if (i.id !== id) return i;
      const next = { ...i };
      if (edit.amount !== undefined) {
        const parsed = parseAmount(edit.amount);
        next.quantity = parsed.quantity;
        next.unit = parsed.unit;
      }
      if (edit.note !== undefined) {
        const note = edit.note.replace(/\s+/g, " ").trim();
        next.note = note ? clip(note, MAX_NOTE_CHARS) : null;
      }
      if (edit.item !== undefined) {
        const name = clip(edit.item.replace(/\s+/g, " ").trim(), MAX_ITEM_CHARS);
        if (name) next.item = name;
      }
      return next;
    }),
    now,
  );
}

const GLYPHS: Record<string, number> = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

/** Parses an amount typed by the cook: "2", "1.5", "1,5", "1/2", "1 1/2", "1½", "½ cup",
 * "400 g", "2 cloves". Text without a leading number ("a bunch") is kept as an unspecified
 * amount with that text as the unit; "" clears the amount. */
export function parseAmount(text: string): { quantity: number | null; unit: string | null } {
  const s = text.replace(/\s+/g, " ").trim();
  if (!s) return { quantity: null, unit: null };
  const m = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+\s?[¼½¾⅓⅔⅛]|[¼½¾⅓⅔⅛]|\d+(?:[.,]\d+)?)\s*(.*)$/.exec(s);
  if (!m) return { quantity: null, unit: clip(s, MAX_UNIT_CHARS) };
  const raw = m[1]!.replace(",", ".");
  let quantity: number;
  let parts: RegExpExecArray | null;
  if ((parts = /^(\d+)\s+(\d+)\/(\d+)$/.exec(raw))) {
    quantity = Number(parts[1]) + Number(parts[2]) / Number(parts[3]);
  } else if ((parts = /^(\d+)\/(\d+)$/.exec(raw))) {
    quantity = Number(parts[1]) / Number(parts[2]);
  } else if ((parts = /^(\d+)\s?([¼½¾⅓⅔⅛])$/.exec(raw))) {
    quantity = Number(parts[1]) + GLYPHS[parts[2]!]!;
  } else if (raw in GLYPHS) {
    quantity = GLYPHS[raw]!;
  } else {
    quantity = Number(raw);
  }
  if (!Number.isFinite(quantity)) return { quantity: null, unit: null };
  const unit = m[2]!.trim();
  return { quantity: roundQty(quantity), unit: unit ? clip(unit, MAX_UNIT_CHARS) : null };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** "2 cloves" / "400 g" / "3" / "" (unspecified). */
export function formatAmount(item: Pick<ShoppingItem, "quantity" | "unit">): string {
  if (item.quantity === null) return item.unit ?? "";
  const q = formatQuantity(item.quantity);
  const u = formatUnit(item.unit, item.quantity);
  return u ? `${q} ${u}` : q;
}

/** One line for a message: "2 cloves garlic (minced)". */
export function formatItemLine(item: ShoppingItem): string {
  const amount = formatAmount(item);
  const note = item.note ? ` (${item.note})` : "";
  return `${amount ? `${amount} ` : ""}${item.item}${note}`;
}

export type ShoppingCategory = "produce" | "dairy" | "meat" | "pantry" | "spices" | "other";

export const CATEGORY_ORDER: ShoppingCategory[] = ["produce", "dairy", "meat", "pantry", "spices", "other"];

export const CATEGORY_LABEL: Record<ShoppingCategory, string> = {
  produce: "Produce",
  dairy: "Dairy & eggs",
  meat: "Meat & fish",
  pantry: "Pantry",
  spices: "Spices",
  other: "Other",
};

// Ordered: the first match wins, so specific phrases come before the single words they contain
// ("black pepper" before "pepper", "coconut milk" before "milk", "garlic powder" before "garlic").
const CATEGORY_RULES: Array<[string, ShoppingCategory]> = [
  // phrases
  ["coconut milk", "pantry"],
  ["coconut cream", "pantry"],
  ["peanut butter", "pantry"],
  ["soy sauce", "pantry"],
  ["fish sauce", "pantry"],
  ["oyster sauce", "pantry"],
  ["tomato paste", "pantry"],
  ["tomato sauce", "pantry"],
  ["tomato puree", "pantry"],
  ["canned tomato", "pantry"],
  ["chopped tomato", "pantry"],
  ["egg noodle", "pantry"],
  ["baking powder", "pantry"],
  ["baking soda", "pantry"],
  ["garlic powder", "spices"],
  ["onion powder", "spices"],
  ["chili powder", "spices"],
  ["chilli powder", "spices"],
  ["chili flake", "spices"],
  ["chilli flake", "spices"],
  ["red pepper flake", "spices"],
  ["curry powder", "spices"],
  ["garam masala", "spices"],
  ["five spice", "spices"],
  ["bay leaf", "spices"],
  ["black pepper", "spices"],
  ["white pepper", "spices"],
  ["bell pepper", "produce"],
  ["red pepper", "produce"],
  ["green pepper", "produce"],
  ["yellow pepper", "produce"],
  ["chili pepper", "produce"],
  ["spring onion", "produce"],
  ["green onion", "produce"],
  ["sour cream", "dairy"],
  ["cream cheese", "dairy"],
  ["ground beef", "meat"],
  ["ground pork", "meat"],
  // produce
  ["onion", "produce"],
  ["shallot", "produce"],
  ["garlic", "produce"],
  ["ginger", "produce"],
  ["scallion", "produce"],
  ["leek", "produce"],
  ["tomato", "produce"],
  ["potato", "produce"],
  ["carrot", "produce"],
  ["celery", "produce"],
  ["lettuce", "produce"],
  ["spinach", "produce"],
  ["kale", "produce"],
  ["cabbage", "produce"],
  ["broccoli", "produce"],
  ["cauliflower", "produce"],
  ["cucumber", "produce"],
  ["zucchini", "produce"],
  ["courgette", "produce"],
  ["eggplant", "produce"],
  ["aubergine", "produce"],
  ["mushroom", "produce"],
  ["avocado", "produce"],
  ["lemon", "produce"],
  ["lime", "produce"],
  ["orange", "produce"],
  ["apple", "produce"],
  ["banana", "produce"],
  ["berry", "produce"],
  ["chili", "produce"],
  ["chilli", "produce"],
  ["jalapeno", "produce"],
  ["jalapeño", "produce"],
  ["cilantro", "produce"],
  ["coriander", "produce"],
  ["parsley", "produce"],
  ["basil", "produce"],
  ["mint", "produce"],
  ["dill", "produce"],
  ["chives", "produce"],
  ["thyme", "produce"],
  ["rosemary", "produce"],
  ["corn", "produce"],
  ["pea", "produce"],
  ["bean sprout", "produce"],
  ["bok choy", "produce"],
  ["squash", "produce"],
  ["pumpkin", "produce"],
  ["sweet potato", "produce"],
  // dairy & eggs
  ["egg", "dairy"],
  ["milk", "dairy"],
  ["butter", "dairy"],
  ["cream", "dairy"],
  ["cheese", "dairy"],
  ["parmesan", "dairy"],
  ["mozzarella", "dairy"],
  ["cheddar", "dairy"],
  ["feta", "dairy"],
  ["yogurt", "dairy"],
  ["yoghurt", "dairy"],
  ["ghee", "dairy"],
  // meat & fish
  ["chicken", "meat"],
  ["beef", "meat"],
  ["pork", "meat"],
  ["lamb", "meat"],
  ["bacon", "meat"],
  ["sausage", "meat"],
  ["ham", "meat"],
  ["turkey", "meat"],
  ["mince", "meat"],
  ["steak", "meat"],
  ["fish", "meat"],
  ["salmon", "meat"],
  ["tuna", "meat"],
  ["cod", "meat"],
  ["shrimp", "meat"],
  ["prawn", "meat"],
  ["anchovies", "meat"],
  ["anchovy", "meat"],
  // spices
  ["salt", "spices"],
  ["pepper", "spices"],
  ["peppercorn", "spices"],
  ["cumin", "spices"],
  ["paprika", "spices"],
  ["cinnamon", "spices"],
  ["turmeric", "spices"],
  ["nutmeg", "spices"],
  ["oregano", "spices"],
  ["cardamom", "spices"],
  ["clove", "spices"],
  ["msg", "spices"],
  ["spice", "spices"],
  ["seasoning", "spices"],
  // pantry
  ["flour", "pantry"],
  ["sugar", "pantry"],
  ["rice", "pantry"],
  ["pasta", "pantry"],
  ["spaghetti", "pantry"],
  ["noodle", "pantry"],
  ["oil", "pantry"],
  ["vinegar", "pantry"],
  ["sauce", "pantry"],
  ["stock", "pantry"],
  ["broth", "pantry"],
  ["bean", "pantry"],
  ["lentil", "pantry"],
  ["chickpea", "pantry"],
  ["honey", "pantry"],
  ["syrup", "pantry"],
  ["cornstarch", "pantry"],
  ["starch", "pantry"],
  ["yeast", "pantry"],
  ["oat", "pantry"],
  ["oats", "pantry"],
  ["bread", "pantry"],
  ["breadcrumb", "pantry"],
  ["panko", "pantry"],
  ["nut", "pantry"],
  ["almond", "pantry"],
  ["peanut", "pantry"],
  ["cashew", "pantry"],
  ["sesame", "pantry"],
  ["wine", "pantry"],
  ["mirin", "pantry"],
  ["sake", "pantry"],
  ["water", "pantry"],
  ["mustard", "pantry"],
  ["ketchup", "pantry"],
  ["mayonnaise", "pantry"],
  ["mayo", "pantry"],
  ["vanilla", "pantry"],
  ["chocolate", "pantry"],
  ["cocoa", "pantry"],
  ["gochujang", "pantry"],
  ["miso", "pantry"],
  ["paste", "pantry"],
];

const RULE_PATTERNS: Array<[RegExp, ShoppingCategory]> = CATEGORY_RULES.map(([word, cat]) => [
  new RegExp(`(?:^|[^a-zà-ÿ])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-zà-ÿ])`),
  cat,
]);

/** A rough aisle for an item name (keyword map; "other" when nothing matches). */
export function categorize(name: string): ShoppingCategory {
  const key = normalizeItemName(name);
  for (const [re, cat] of RULE_PATTERNS) {
    if (re.test(key)) return cat;
  }
  return "other";
}

export interface ShoppingGroup {
  category: ShoppingCategory;
  label: string;
  items: ShoppingItem[];
}

/** Unchecked items grouped by aisle (in CATEGORY_ORDER, oldest first within a group), then the
 * checked ones in their own trailing list. */
export function groupForDisplay(list: ShoppingListDoc): { groups: ShoppingGroup[]; checked: ShoppingItem[] } {
  const byCat = new Map<ShoppingCategory, ShoppingItem[]>();
  const checked: ShoppingItem[] = [];
  for (const item of list.items) {
    if (item.checked) {
      checked.push(item);
      continue;
    }
    const cat = categorize(item.item);
    const arr = byCat.get(cat) ?? [];
    arr.push(item);
    byCat.set(cat, arr);
  }
  const groups = CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
    category: c,
    label: CATEGORY_LABEL[c],
    items: byCat.get(c)!,
  }));
  return { groups, checked };
}

/** A plain list for messaging apps: the items still to buy, grouped by aisle. */
export function listToText(list: ShoppingListDoc): string {
  const { groups } = groupForDisplay(list);
  if (groups.length === 0) return "";
  const lines: string[] = [];
  for (const g of groups) {
    if (groups.length > 1) {
      if (lines.length > 0) lines.push("");
      lines.push(`${g.label}:`);
    }
    for (const item of g.items) lines.push(`- ${formatItemLine(item)}`);
  }
  return lines.join("\n");
}

/** Keeps the valid items of a stored list (anything malformed is dropped rather than failing the
 * whole list), capped at MAX_SHOPPING_ITEMS. */
export function parseStoredList(value: unknown): ShoppingListDoc | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { items?: unknown; updatedAt?: unknown };
  if (!Array.isArray(raw.items)) return null;
  const items: ShoppingItem[] = [];
  for (const candidate of raw.items) {
    const parsed = ShoppingItem.safeParse(candidate);
    if (parsed.success) items.push(parsed.data);
    if (items.length >= MAX_SHOPPING_ITEMS) break;
  }
  return { items, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString() };
}
