import { describe, expect, it } from "vitest";
import type { StatsDay } from "@recipe/shared";
import { emptyDay, fillStatsRange, formatPct, funnel, niceMax, parseAdminStats, totalStats } from "./adminStats";

const NOW = new Date("2026-10-16T09:30:00Z");
const day = (date: string, over: Partial<StatsDay> = {}): StatsDay => ({ ...emptyDay(date), ...over });

describe("parseAdminStats", () => {
  it("accepts the contract shape and rejects anything else", () => {
    const ok = parseAdminStats({ days: [day("2026-10-16", { visit: 4, signup: 1 })] });
    expect(ok.days[0]!.visit).toBe(4);
    expect(() => parseAdminStats({ days: [{ date: "2026-10-16", visit: 1 }] })).toThrow();
    expect(() => parseAdminStats({ days: [day("2026-10-16", { visit: 1.5 })] })).toThrow();
    expect(() => parseAdminStats(null)).toThrow();
  });
});

describe("fillStatsRange", () => {
  it("returns exactly N consecutive UTC days ending today, oldest first, zeros filled", () => {
    const days = fillStatsRange([day("2026-10-14", { visit: 2 }), day("2026-10-16", { visit: 7 })], 14, NOW);
    expect(days).toHaveLength(14);
    expect(days[0]!.date).toBe("2026-10-03");
    expect(days[13]!.date).toBe("2026-10-16");
    expect(days.map((d) => d.visit).slice(-3)).toEqual([2, 0, 7]);
  });

  it("drops days outside the range, sums duplicates, and caps N at MAX_STATS_DAYS", () => {
    const days = fillStatsRange(
      [day("2026-09-01", { visit: 99 }), day("2026-10-16", { publish: 1 }), day("2026-10-16", { publish: 2 }), day("2026-10-17", { visit: 5 })],
      14,
      NOW,
    );
    expect(totalStats(days).visit).toBe(0);
    expect(days[13]!.publish).toBe(3);
    expect(fillStatsRange([], 500, NOW)).toHaveLength(90);
    expect(fillStatsRange([], 0, NOW)).toHaveLength(1);
  });

  it("crosses month and DST boundaries without skipping or repeating a day", () => {
    const days = fillStatsRange([], 90, new Date("2026-11-02T23:59:00Z"));
    const dates = days.map((d) => d.date);
    expect(new Set(dates).size).toBe(90);
    expect(dates[89]).toBe("2026-11-02");
    expect(dates).toContain("2026-10-25");
    expect(dates[0]).toBe("2026-08-05");
  });
});

describe("totals and funnel", () => {
  const days = [
    day("2026-10-15", { visit: 150, signup: 10, recipe_created: 6, publish: 1, recipe_view: 40 }),
    day("2026-10-16", { visit: 50, signup: 2, recipe_created: 3, publish: 2, captions_used: 1 }),
  ];

  it("totals every metric", () => {
    expect(totalStats(days)).toEqual({
      visit: 200,
      recipe_view: 40,
      explore_view: 0,
      captions_used: 1,
      signup: 12,
      recipe_created: 9,
      publish: 3,
    });
  });

  it("computes % of the previous step", () => {
    const steps = funnel(totalStats(days));
    expect(steps.map((s) => s.label)).toEqual(["Visits", "Sign-ups", "Recipes created", "Publishes"]);
    expect(steps.map((s) => s.value)).toEqual([200, 12, 9, 3]);
    expect(steps.map((s) => s.pctOfPrevious)).toEqual([null, 6, 75, 33.3]);
  });

  it("has no percentage after a zero step, and allows > 100%", () => {
    const steps = funnel({ ...totalStats([]), visit: 0, signup: 3, recipe_created: 9 });
    expect(steps[1]!.pctOfPrevious).toBeNull();
    expect(steps[2]!.pctOfPrevious).toBe(300);
    expect(steps[3]!.pctOfPrevious).toBe(0);
  });

  it("formats percentages", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(33.3)).toBe("33%");
    expect(formatPct(6)).toBe("6%");
    expect(formatPct(2.5)).toBe("2.5%");
    expect(formatPct(0)).toBe("0%");
  });

  it("picks a nice chart maximum", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(18)).toBe(20);
    expect(niceMax(21)).toBe(25);
    expect(niceMax(240)).toBe(250);
    expect(niceMax(4100)).toBe(5000);
  });
});
