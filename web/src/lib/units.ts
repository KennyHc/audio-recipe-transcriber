// Pure, view-only unit conversion. Nothing here mutates or is ever persisted —
// callers convert on render only.

export type UnitSystem = "original" | "metric" | "imperial";

type Dimension = "volume" | "weight";

export interface UnitDef {
  canonical: string; // short display form, e.g. "tbsp"
  dimension: Dimension;
  toBase: number; // multiplier to base unit (ml for volume, g for weight)
}

// Base units: volume -> ml, weight -> g.
const UNIT_ALIASES: Record<string, UnitDef> = {};

/**
 * Read-only view of the measured-unit alias table (tsp/tbsp/cup/ml/g/...), so other
 * modules (e.g. stepQuantities.ts, which finds quantity+unit mentions in free-text step
 * instructions) can recognize/scale the same units `convertQuantity` knows about, without
 * duplicating the alias list.
 */
export function lookupMeasuredUnit(unit: string): UnitDef | undefined {
  return UNIT_ALIASES[unit.trim().toLowerCase()];
}

/** All recognized alias words/phrases for measured units, e.g. "tbsp", "tablespoons". */
export function measuredUnitWords(): string[] {
  return Object.keys(UNIT_ALIASES);
}

function reg(aliases: string[], canonical: string, dimension: Dimension, toBase: number) {
  const def: UnitDef = { canonical, dimension, toBase };
  for (const a of aliases) UNIT_ALIASES[a.toLowerCase()] = def;
}

// No single-letter "t"/"T": lookups are lowercased, so it would conflate tsp and tbsp.
reg(["tsp", "teaspoon", "teaspoons"], "tsp", "volume", 4.92892);
reg(["tbsp", "tablespoon", "tablespoons", "tbs", "tb"], "tbsp", "volume", 14.7868);
reg(["cup", "cups", "c"], "cup", "volume", 236.588);
reg(["fl oz", "fluid ounce", "fluid ounces", "floz"], "fl oz", "volume", 29.5735);
reg(["ml", "milliliter", "milliliters", "millilitre", "millilitres"], "ml", "volume", 1);
reg(["l", "liter", "liters", "litre", "litres"], "l", "volume", 1000);

reg(["oz", "ounce", "ounces"], "oz", "weight", 28.3495);
reg(["lb", "lbs", "pound", "pounds"], "lb", "weight", 453.592);
reg(["g", "gram", "grams"], "g", "weight", 1);
reg(["kg", "kilogram", "kilograms"], "kg", "weight", 1000);

export interface ConvertedQuantity {
  quantity: number;
  unit: string;
}

/**
 * Convert a quantity/unit pair for display in the given unit system.
 * Unknown or non-measurement units (clove, pinch, handful, can, ...) pass through untouched.
 * `system: "original"` always passes through untouched.
 */
export function convertQuantity(
  quantity: number | null,
  unit: string | null,
  system: UnitSystem,
): ConvertedQuantity | { quantity: number | null; unit: string | null } {
  if (system === "original" || quantity === null || unit === null) {
    return { quantity, unit };
  }
  const def = UNIT_ALIASES[unit.trim().toLowerCase()];
  if (!def) return { quantity, unit };

  const baseAmount = quantity * def.toBase;

  if (def.dimension === "volume") {
    return system === "metric"
      ? toMetricVolume(baseAmount)
      : toImperialVolume(baseAmount);
  }
  return system === "metric" ? toMetricWeight(baseAmount) : toImperialWeight(baseAmount);
}

function toMetricVolume(ml: number): ConvertedQuantity {
  if (ml >= 1000) {
    return { quantity: roundTo(ml / 1000, 2), unit: "l" };
  }
  return { quantity: roundNiceMl(ml), unit: "ml" };
}

function toMetricWeight(g: number): ConvertedQuantity {
  if (g >= 1000) {
    return { quantity: roundTo(g / 1000, 2), unit: "kg" };
  }
  return { quantity: roundNiceGrams(g), unit: "g" };
}

function toImperialVolume(ml: number): ConvertedQuantity {
  const tsp = ml / 4.92892;
  const tbsp = ml / 14.7868;
  const cup = ml / 236.588;
  const flOz = ml / 29.5735;

  if (cup >= 0.2) {
    return { quantity: roundToEighth(cup), unit: "cup" };
  }
  if (tbsp >= 1.5) {
    return { quantity: roundToEighth(tbsp), unit: "tbsp" };
  }
  if (tsp >= 0.2) {
    return { quantity: roundToEighth(tsp), unit: "tsp" };
  }
  return { quantity: roundTo(flOz, 2), unit: "fl oz" };
}

function toImperialWeight(g: number): ConvertedQuantity {
  const oz = g / 28.3495;
  const lb = g / 453.592;
  if (lb >= 1) {
    return { quantity: roundTo(lb, 2), unit: "lb" };
  }
  return { quantity: roundTo(oz, 2), unit: "oz" };
}

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function roundNiceMl(ml: number): number {
  // 1 tbsp = 14.8 ml should read "15 ml"; only tiny amounts keep a decimal.
  if (ml < 5) return roundTo(ml, 1);
  if (ml < 15) return Math.round(ml);
  const step = ml < 100 ? 5 : 10;
  return Math.round(ml / step) * step;
}

function roundNiceGrams(g: number): number {
  if (g < 20) return roundTo(g, 1);
  const step = g < 100 ? 5 : 10;
  return Math.round(g / step) * step;
}

/** Round to the nearest eighth so formatQuantity's fraction glyphs kick in. */
function roundToEighth(n: number): number {
  return Math.round(n * 8) / 8;
}

// ---------------------------------------------------------------------------
// Temperature: convert numbers embedded in free text ("350°F", "180C", "350 degrees").
// ---------------------------------------------------------------------------

// Case-sensitive on purpose: a lone "F"/"C" must be uppercase (or follow "°") so that
// "2 c of stock" isn't read as 2°C. Matches: 350°F, 180 °C, 180C, 350 degrees F,
// 180 degrees celsius, bare "200 degrees".
const TEMP_RE =
  /(-?\d+(?:\.\d+)?)\s*(?:°\s*([FfCc])\b|([FC])\b|(?:degrees?\s+)?([Ff]ahrenheit|[Cc]elsius)\b|degrees?(?:\s+([FC])\b)?)/g;

function fToC(f: number): number {
  return ((f - 32) * 5) / 9;
}
function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

/** Convert temperature mentions inside a free-text string for the given unit system. */
export function convertTemperatureText(text: string, system: UnitSystem): string {
  if (system === "original" || !text) return text;

  return text.replace(
    TEMP_RE,
    (match, numStr: string, deg?: string, bare?: string, word?: string, afterDegrees?: string) => {
    const value = parseFloat(numStr);
    if (Number.isNaN(value)) return match;

    const unitStr = (deg ?? bare ?? word ?? afterDegrees)?.toLowerCase();
    let sourceIsF: boolean;
    if (unitStr?.startsWith("f")) {
      sourceIsF = true;
    } else if (unitStr?.startsWith("c")) {
      sourceIsF = false;
    } else {
      // Bare "degrees": oven temps of 275+ are almost always °F, 100–270 almost always °C.
      // Below 100 it's too ambiguous (could even be an angle) — leave it alone.
      if (value < 100) return match;
      sourceIsF = value >= 275;
    }

    const wantF = system === "imperial";
    if (wantF === sourceIsF) {
      // Already in the target scale; normalize formatting but keep the value.
      return `${Math.round(value)}°${wantF ? "F" : "C"}`;
    }

    const converted = wantF ? cToF(value) : fToC(value);
    const rounded = Math.round(converted / 5) * 5;
    return `${rounded}°${wantF ? "F" : "C"}`;
  });
}
