// Formatting helpers for quantities, durations, and timestamps.

const FRACTIONS: Array<{ value: number; glyph: string }> = [
  { value: 1 / 8, glyph: "⅛" },
  { value: 1 / 4, glyph: "¼" },
  { value: 1 / 3, glyph: "⅓" },
  { value: 1 / 2, glyph: "½" },
  { value: 2 / 3, glyph: "⅔" },
  { value: 3 / 4, glyph: "¾" },
];

const EPSILON = 0.03;

/** Format a numeric quantity as a friendly string, using unicode fractions where they fit. */
export function formatQuantity(qty: number | null | undefined): string {
  if (qty === null || qty === undefined) return "";
  if (qty === 0) return "0";

  const sign = qty < 0 ? "-" : "";
  const abs = Math.abs(qty);
  const whole = Math.floor(abs);
  const frac = abs - whole;

  if (frac < EPSILON) {
    return `${sign}${whole || 0}`;
  }

  for (const f of FRACTIONS) {
    if (Math.abs(frac - f.value) < EPSILON) {
      return `${sign}${whole > 0 ? `${whole} ` : ""}${f.glyph}`;
    }
  }

  // No clean fraction match: round to at most 2 decimal places, trim trailing zeros.
  const rounded = Math.round(abs * 100) / 100;
  return `${sign}${trimTrailingZeros(rounded)}`;
}

function trimTrailingZeros(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "");
}

/** mm:ss (or h:mm:ss) timestamp label for a seconds offset. */
export function formatTimestamp(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * e.g. 90 -> "1 hr 30 min", 45 -> "45 min", 0.5 -> "30 sec", 1.5 -> "1 min 30 sec"
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "";
  const totalSeconds = Math.round(minutes * 60);
  if (totalSeconds <= 0) return "0 min";

  const h = Math.floor(totalSeconds / 3600);
  const remAfterHours = totalSeconds % 3600;
  const m = Math.floor(remAfterHours / 60);
  const s = remAfterHours % 60;

  const parts: string[] = [];
  if (h > 0) parts.push(`${h} hr`);
  if (m > 0) parts.push(`${m} min`);
  if (s > 0) parts.push(`${s} sec`);
  return parts.join(" ");
}

// Count-ish / word units that get pluralised for quantity > 1. Abbreviations
// (tbsp, tsp, g, ml, oz, lb, kg, l, fl oz) are never pluralised.
/**
 * Exported so stepQuantities.ts can recognize the same countable unit words (clove, can,
 * slice, ...) when scanning free-text step instructions, without duplicating the list.
 */
export const PLURAL_UNITS: Record<string, string> = {
  clove: "cloves",
  cup: "cups",
  can: "cans",
  slice: "slices",
  pinch: "pinches",
  handful: "handfuls",
  sprig: "sprigs",
  stalk: "stalks",
  bunch: "bunches",
  piece: "pieces",
};

/**
 * Pluralise a unit word for display when the quantity calls for it, e.g.
 * formatUnit("clove", 6) -> "cloves", formatUnit("cup", 2) -> "cups",
 * formatUnit("cup", 0.5) -> "cup". Only touches the whitelisted count-ish
 * words above; abbreviations and unknown units pass through unchanged.
 */
export function formatUnit(unit: string | null | undefined, quantity: number | null | undefined): string | null {
  if (!unit) return unit ?? null;
  if (quantity === null || quantity === undefined || quantity <= 1 + EPSILON) return unit;
  const plural = PLURAL_UNITS[unit.trim().toLowerCase()];
  return plural ?? unit;
}

const FRIENDLY_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** Friendly absolute date, e.g. "Sep 26, 2026", with "Today"/"Yesterday" for recent days. */
export function formatFriendlyDate(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return FRIENDLY_DATE_FORMAT.format(then);
}

/** Relative time label, e.g. "2 hours ago", "just now". */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}
