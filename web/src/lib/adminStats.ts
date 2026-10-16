// The admin Stats section's pure logic (contract: shared/stats.ts). The API returns one entry per
// UTC day, oldest first, zeros included — but the page doesn't rely on that: fillStatsRange()
// rebuilds exactly `days` consecutive days ending today (UTC), so a gap, a duplicate, or a day
// from outside the range can't skew the chart or the totals.

import { AdminStatsResponse, MAX_STATS_DAYS, type StatsDay } from "@recipe/shared";

export const STATS_RANGES = [14, 30, 90] as const satisfies readonly number[];
export type StatsRange = (typeof STATS_RANGES)[number];

export type StatsMetric = Exclude<keyof StatsDay, "date">;

export const STATS_METRICS: ReadonlyArray<{ key: StatsMetric; label: string; short: string }> = [
  { key: "visit", label: "Visits", short: "Visits" },
  { key: "recipe_view", label: "Recipe views", short: "Views" },
  { key: "explore_view", label: "Explore views", short: "Explore" },
  { key: "captions_used", label: "Captions used", short: "Captions" },
  { key: "signup", label: "Sign-ups", short: "Sign-ups" },
  { key: "recipe_created", label: "Recipes created", short: "Created" },
  { key: "publish", label: "Publishes", short: "Published" },
];

/** Parses an /admin/stats payload; throws on anything that doesn't match the contract. */
export function parseAdminStats(payload: unknown): AdminStatsResponse {
  return AdminStatsResponse.parse(payload);
}

/** "2026-10-16" for a Date, in UTC (the server's day boundary). */
export function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function emptyDay(date: string): StatsDay {
  return { date, visit: 0, recipe_view: 0, explore_view: 0, captions_used: 0, signup: 0, recipe_created: 0, publish: 0 };
}

/** Exactly `days` consecutive UTC days ending on `now`'s day, oldest first; missing days are
 * zeros, days outside the range are dropped, duplicates are summed. */
export function fillStatsRange(input: readonly StatsDay[], days: number, now: Date = new Date()): StatsDay[] {
  const n = Math.max(1, Math.min(MAX_STATS_DAYS, Math.floor(days)));
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out: StatsDay[] = [];
  const byDate = new Map<string, StatsDay>();
  for (let i = n - 1; i >= 0; i--) {
    const day = emptyDay(utcDateString(new Date(end - i * 86_400_000)));
    out.push(day);
    byDate.set(day.date, day);
  }
  for (const d of input) {
    const slot = byDate.get(d.date);
    if (!slot) continue;
    for (const { key } of STATS_METRICS) slot[key] += Math.max(0, d[key]);
  }
  return out;
}

export type StatsTotals = Record<StatsMetric, number>;

export function totalStats(days: readonly StatsDay[]): StatsTotals {
  const totals = { ...emptyDay("") } as StatsDay;
  for (const d of days) for (const { key } of STATS_METRICS) totals[key] += d[key];
  const { date: _date, ...rest } = totals;
  return rest;
}

export interface FunnelStep {
  key: StatsMetric;
  label: string;
  value: number;
  /** Percent of the previous step (0–100+, rounded to 0.1); null for the first step or when
   * the previous step is 0. */
  pctOfPrevious: number | null;
}

const FUNNEL: ReadonlyArray<{ key: StatsMetric; label: string }> = [
  { key: "visit", label: "Visits" },
  { key: "signup", label: "Sign-ups" },
  { key: "recipe_created", label: "Recipes created" },
  { key: "publish", label: "Publishes" },
];

/** Visits → sign-ups → recipes created → publishes, with the conversion between steps. Counts
 * are independent daily totals (not the same people), so a step can exceed 100%. */
export function funnel(totals: StatsTotals): FunnelStep[] {
  return FUNNEL.map((step, i) => {
    const value = totals[step.key];
    const prev = i === 0 ? null : totals[FUNNEL[i - 1]!.key];
    const pctOfPrevious = prev === null || prev === 0 ? null : Math.round((value / prev) * 1000) / 10;
    return { ...step, value, pctOfPrevious };
  });
}

export function formatPct(pct: number | null): string {
  if (pct === null) return "—";
  return `${pct >= 10 ? Math.round(pct) : pct.toFixed(1).replace(/\.0$/, "")}%`;
}

/** The chart's y-axis top: a "nice" number ≥ max (1, 2, 2.5, 5 × 10^k), at least 1. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

const DAY_LABEL = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const WEEKDAY_LABEL = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });

/** "Oct 16" for a UTC YYYY-MM-DD. */
export function formatStatsDate(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(t) ? date : DAY_LABEL.format(t);
}

export function formatStatsWeekday(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(t) ? "" : WEEKDAY_LABEL.format(t);
}
