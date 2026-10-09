// Pure logic — no emulator needed: `npx vitest run test/unit`.
import { describe, expect, it } from "vitest";
import { release, settle, tryReserve } from "../../src/budget";
import { actualCostUsd, estimateMaxCostUsd, priceFor } from "../../src/cost";
import { refundUsage, rolloverUsage, toUsage, tryConsume } from "../../src/quota";
import {
  nextUtcMonthStart,
  secondsUntilNextUtcMidnight,
  secondsUntilNextUtcMonth,
  utcDateString,
  utcMonthString,
} from "../../src/time";

describe("time", () => {
  it("formats UTC day and month regardless of local offsets", () => {
    const d = new Date("2026-10-31T23:59:59.999Z");
    expect(utcDateString(d)).toBe("2026-10-31");
    expect(utcMonthString(d)).toBe("2026-10");
  });

  it("finds the next month start, including December → January", () => {
    expect(nextUtcMonthStart(new Date("2026-10-08T12:00:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(nextUtcMonthStart(new Date("2026-12-31T23:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("counts seconds until the next month / midnight, never below 1", () => {
    expect(secondsUntilNextUtcMonth(new Date("2026-10-31T23:59:00Z"))).toBe(60);
    expect(secondsUntilNextUtcMonth(new Date("2026-10-31T23:59:59.999Z"))).toBe(1);
    expect(secondsUntilNextUtcMidnight(new Date("2026-10-08T23:00:00Z"))).toBe(3600);
  });
});

describe("cost", () => {
  it("prices known models and strips date suffixes", () => {
    expect(priceFor("claude-haiku-4-5")).toEqual({ input: 1, output: 5 });
    expect(priceFor("claude-haiku-4-5-20251001")).toEqual({ input: 1, output: 5 });
  });

  it("falls back to the most expensive known price for unknown models", () => {
    expect(priceFor("claude-unknown")).toEqual({ input: 5, output: 25 });
  });

  it("estimates worst case as all max_tokens billed as output", () => {
    // 4000 chars ≈ 1000 tokens × $1 + 8000 × $5, per million
    expect(estimateMaxCostUsd("claude-haiku-4-5", 4000, 8000)).toBeCloseTo(0.041, 10);
  });

  it("computes actual cost including cache reads/writes", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 };
    expect(actualCostUsd("claude-haiku-4-5", usage)).toBeCloseTo(1 + 5 + 0.1 + 1.25, 10);
  });
});

describe("budget transitions", () => {
  it("reserves while there is room and refuses past the cap", () => {
    const s1 = tryReserve(undefined, 0.5, 1)!;
    expect(s1).toEqual({ reservedUsd: 0.5, settledUsd: 0 });
    expect(tryReserve(s1, 0.5, 1)).toEqual({ reservedUsd: 1, settledUsd: 0 });
    expect(tryReserve(s1, 0.51, 1)).toBeNull();
    expect(tryReserve({ reservedUsd: 0, settledUsd: 1 }, 0.01, 1)).toBeNull();
  });

  it("a zero budget refuses everything", () => {
    expect(tryReserve(undefined, 0.0001, 0)).toBeNull();
  });

  it("settle swaps the reservation for the actual cost", () => {
    expect(settle({ reservedUsd: 0.5, settledUsd: 0.25 }, 0.5, 0.125)).toEqual({ reservedUsd: 0, settledUsd: 0.375 });
  });

  it("release frees the reservation and never goes negative", () => {
    expect(release({ reservedUsd: 0.5, settledUsd: 0.1 }, 0.2)).toEqual({ reservedUsd: 0.3, settledUsd: 0.1 });
    // A release against a fresh doc (e.g. the other side of midnight) must not go below 0.
    expect(release(undefined, 0.2)).toEqual({ reservedUsd: 0, settledUsd: 0 });
    expect(settle(undefined, 0.2, 0.01)).toEqual({ reservedUsd: 0, settledUsd: 0.01 });
  });
});

describe("quota transitions", () => {
  const now = new Date("2026-10-15T10:00:00Z");

  it("rolls a previous month's count over to zero", () => {
    expect(rolloverUsage({ month: "2026-09", recipesCreated: 30 }, "2026-10")).toEqual({ month: "2026-10", recipesCreated: 0 });
    expect(rolloverUsage(undefined, "2026-10")).toEqual({ month: "2026-10", recipesCreated: 0 });
    expect(rolloverUsage({ month: "2026-10", recipesCreated: 4 }, "2026-10")).toEqual({ month: "2026-10", recipesCreated: 4 });
  });

  it("increments under the limit", () => {
    expect(tryConsume({ month: "2026-10", recipesCreated: 2 }, now, 3)).toEqual({
      ok: true,
      state: { month: "2026-10", recipesCreated: 3 },
    });
  });

  it("refuses at the limit with seconds until next month", () => {
    const r = tryConsume({ month: "2026-10", recipesCreated: 3 }, now, 3);
    expect(r).toEqual({ ok: false, retryAfterSeconds: secondsUntilNextUtcMonth(now) });
  });

  it("a full previous month doesn't block the new one", () => {
    const r = tryConsume({ month: "2026-09", recipesCreated: 3 }, now, 3);
    expect(r).toEqual({ ok: true, state: { month: "2026-10", recipesCreated: 1 } });
  });

  it("refunds only within the month the recipe was counted in", () => {
    expect(refundUsage({ month: "2026-10", recipesCreated: 2 }, "2026-10")).toEqual({ month: "2026-10", recipesCreated: 1 });
    expect(refundUsage({ month: "2026-10", recipesCreated: 0 }, "2026-10")).toEqual({ month: "2026-10", recipesCreated: 0 });
    expect(refundUsage({ month: "2026-11", recipesCreated: 2 }, "2026-10")).toBeNull();
    expect(refundUsage(undefined, "2026-10")).toBeNull();
  });

  it("reports usage with remaining clamped at zero", () => {
    expect(toUsage({ month: "2026-10", recipesCreated: 5 }, now, 3)).toEqual({
      month: "2026-10",
      used: 5,
      limit: 3,
      remaining: 0,
      resetsAt: "2026-11-01T00:00:00.000Z",
    });
    expect(toUsage({ month: "2026-09", recipesCreated: 5 }, now, 3).used).toBe(0);
  });
});
