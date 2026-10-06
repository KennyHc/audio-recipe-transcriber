// Pure, view-only scaling/conversion of quantity+unit mentions inside free-text step
// instructions ("add two tablespoons of soy sauce", "1 cup of pasta water"). Reuses the
// same unit tables and formatters as the ingredient list (units.ts, format.ts) so a step's
// prose stays consistent with the structured ingredient quantities after scaling servings
// or switching the Original/Metric/Imperial toggle.
//
// Deliberately conservative: a number is only rewritten when it is directly attached to a
// recognized unit word (volume/weight/countable), optionally with a single descriptive
// modifier in between ("two more tablespoons", "a heaping tablespoon" — see MODIFIER_WORDS).
// Durations ("cook for 9 minutes"), temperatures ("350 degrees" — handled separately by
// convertTemperatureText), step/list numbering ("Step 2"), vague modifiers with no unit
// attached ("a minute", "two more", "two more minutes"), and unit-less ingredient counts
// ("4 eggs") are all left untouched because none of them end in a known unit word.

import { convertQuantity, lookupMeasuredUnit, measuredUnitWords, type UnitSystem } from "./units";
import { formatQuantity, formatUnit, PLURAL_UNITS } from "./format";

export interface StepTextSegment {
  text: string;
  /** Present only when this segment was rewritten; the original words it replaced. */
  original?: string;
}

const FRACTION_GLYPHS: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
};
const FRACTION_GLYPH_CLASS = Object.keys(FRACTION_GLYPHS).join("");

// Number words recognized immediately before a unit. Longer phrases are listed so the
// regex can match them as a whole (alternation backtracks, so exact ordering here doesn't
// affect correctness, only readability).
const WORD_NUMBERS: Record<string, number> = {
  "a couple of": 2,
  "half a": 0.5,
  half: 0.5,
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Numeric quantity forms: "1 1/2", "1/2", "1 ½" / "1½", "½", "2", "1.5".
const NUMERIC_ALTERNATION = [
  `\\d+\\s+\\d+\\/\\d+`,
  `\\d+\\/\\d+`,
  `\\d+\\s?[${FRACTION_GLYPH_CLASS}]`,
  `[${FRACTION_GLYPH_CLASS}]`,
  `\\d+(?:\\.\\d+)?`,
].join("|");

const WORD_ALTERNATION = Object.keys(WORD_NUMBERS)
  .map((w) => w.split(/\s+/).map(escapeRegExp).join("\\s+"))
  .join("|");

// A single optional descriptive word allowed between the quantity and the unit — kept
// verbatim in the rewritten output ("two more tablespoons" ×2 → "4 more tbsp"). This must
// NOT match when nothing recognizable follows ("two more" alone, "two more minutes"): the
// containing regex still requires a known unit right after, so if the unit is missing the
// whole match (modifier included) backtracks away and nothing is rewritten.
const MODIFIER_WORDS = [
  "more",
  "extra",
  "additional",
  "heaping",
  "heaped",
  "level",
  "generous",
  "scant",
  "big",
  "small",
  "good",
];
const MODIFIER_ALTERNATION = MODIFIER_WORDS.map(escapeRegExp).join("|");

// The single-letter "c" alias for cup is excluded from free-text matching: it collides
// with bare temperature mentions like "180C" (handled separately by
// convertTemperatureText), and "cup"/"cups" already cover normal prose. "g"/"l"/"kg" etc.
// are kept — recipes commonly write "500g", "1l" directly attached to the number, and
// none of them are real standalone English words, so they carry no such ambiguity.
const measuredWords = measuredUnitWords().filter((w) => w !== "c");
const countableWords = Object.entries(PLURAL_UNITS).flatMap(([singular, plural]) => [singular, plural]);
const unitWords = Array.from(new Set([...measuredWords, ...countableWords]));
const UNIT_ALTERNATION = unitWords.map((w) => w.split(/\s+/).map(escapeRegExp).join("\\s+")).join("|");

// A plain \b before the quantity group doesn't work when the quantity starts with a
// unicode fraction glyph (e.g. "½"), since neither side of that boundary is a \w
// character. Use a lookbehind that just rules out being mid-alphanumeric-token instead.
const MENTION_RE = new RegExp(
  `(?<![a-zA-Z0-9])(${NUMERIC_ALTERNATION}|${WORD_ALTERNATION})(?:\\s+(${MODIFIER_ALTERNATION})\\b)?\\s*(${UNIT_ALTERNATION})\\b`,
  "gi",
);

function parseNumericQuantity(raw: string): number {
  const s = raw.trim();

  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return parseInt(m[1], 10) + parseInt(m[2], 10) / parseInt(m[3], 10);

  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return parseInt(m[1], 10) / parseInt(m[2], 10);

  m = s.match(/^(\d+)\s?([¼½¾⅓⅔⅛])$/);
  if (m) return parseInt(m[1], 10) + FRACTION_GLYPHS[m[2]];

  if (s in FRACTION_GLYPHS) return FRACTION_GLYPHS[s];

  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);

  return NaN;
}

function parseQuantityPhrase(raw: string): number {
  const lower = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (lower in WORD_NUMBERS) return WORD_NUMBERS[lower];
  return parseNumericQuantity(raw);
}

/** Scale (and, for measured units, convert) one matched quantity+unit mention, keeping any
 * descriptive modifier word ("more", "heaping", ...) between the quantity and the unit in
 * the output. Returns null when the unit isn't actually one we know how to handle
 * (shouldn't happen given the regex, but keeps this function safe to call standalone). */
const ROUGH_UNITS = new Set(["pinch", "dash", "splash", "handful", "sprinkle", "drizzle", "knob"]);

function rewriteMention(
  quantity: number,
  unitRaw: string,
  modifierRaw: string | undefined,
  scaleFactor: number,
  unitSystem: UnitSystem,
): string | null {
  const scaled = quantity * scaleFactor;
  const modifier = modifierRaw?.trim();
  const measured = lookupMeasuredUnit(unitRaw);
  if (measured) {
    const converted = convertQuantity(scaled, measured.canonical, unitSystem);
    const qtyLabel = formatQuantity(converted.quantity);
    const unitLabel = formatUnit(converted.unit, converted.quantity) ?? converted.unit ?? "";
    return [qtyLabel, modifier, unitLabel].filter(Boolean).join(" ");
  }

  const countableKey = unitRaw.trim().toLowerCase();
  const countableBase =
    countableKey in PLURAL_UNITS
      ? countableKey
      : Object.entries(PLURAL_UNITS).find(([, plural]) => plural === countableKey)?.[0];
  if (countableBase) {
    // Pinches, dashes and handfuls are deliberately rough — "1 ¼ pinches" is noise. Round
    // to whole amounts (at least 1) and leave the text alone if that doesn't change it.
    if (ROUGH_UNITS.has(countableBase)) {
      const rounded = Math.max(1, Math.round(scaled));
      if (rounded === Math.max(1, Math.round(quantity))) return null;
      return [formatQuantity(rounded), modifier, formatUnit(countableBase, rounded) ?? countableBase]
        .filter(Boolean)
        .join(" ");
    }
    const qtyLabel = formatQuantity(scaled);
    const unitLabel = formatUnit(countableBase, scaled) ?? countableBase;
    return [qtyLabel, modifier, unitLabel].filter(Boolean).join(" ");
  }

  return null;
}

/**
 * Find quantity+unit mentions in free-text step instructions and rewrite them for the
 * given scale factor and unit system, returning segments so callers can mark which spans
 * changed (and show the original wording, e.g. in a tooltip). When `scaleFactor` is 1 and
 * `unitSystem` is "original" the text is always returned unchanged, as a single segment.
 */
export function scaleStepText(text: string, scaleFactor: number, unitSystem: UnitSystem): StepTextSegment[] {
  if (!text) return [{ text }];
  if (scaleFactor === 1 && unitSystem === "original") return [{ text }];

  const segments: StepTextSegment[] = [];
  let lastIndex = 0;
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(text))) {
    const [full, qtyRaw, modifierRaw, unitRaw] = match;
    const quantity = parseQuantityPhrase(qtyRaw);
    if (Number.isNaN(quantity)) continue;

    const rewritten = rewriteMention(quantity, unitRaw, modifierRaw, scaleFactor, unitSystem);
    if (rewritten === null || rewritten.toLowerCase() === full.toLowerCase()) continue;

    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }
    segments.push({ text: rewritten, original: full });
    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex) });
  if (segments.length === 0) return [{ text }];
  return segments;
}

/** Plain-text convenience for callers that don't need segment/original markup (e.g. the
 * Markdown export). */
export function scaleStepTextPlain(text: string, scaleFactor: number, unitSystem: UnitSystem): string {
  return scaleStepText(text, scaleFactor, unitSystem)
    .map((s) => s.text)
    .join("");
}
