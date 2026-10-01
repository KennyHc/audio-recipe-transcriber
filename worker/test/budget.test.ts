import { describe, expect, it } from "vitest";
import {
  type BudgetDayState,
  release,
  rolloverBudget,
  rolloverVisitor,
  settle,
  tryIncrementVisitor,
  tryReserve,
  type VisitorDayState,
} from "../src/budget";

const TODAY = "2026-10-01";
const YESTERDAY = "2026-09-30";
const NOW = new Date("2026-10-01T12:00:00.000Z");

describe("rolloverVisitor / rolloverBudget", () => {
  it("starts fresh when there's no prior state", () => {
    expect(rolloverVisitor(undefined, TODAY)).toEqual({ date: TODAY, count: 0 });
    expect(rolloverBudget(undefined, TODAY)).toEqual({ date: TODAY, reservedUsd: 0, settledUsd: 0 });
  });

  it("keeps same-day state as-is", () => {
    const v: VisitorDayState = { date: TODAY, count: 3 };
    expect(rolloverVisitor(v, TODAY)).toEqual(v);
  });

  it("resets state from a previous UTC day", () => {
    const v: VisitorDayState = { date: YESTERDAY, count: 20 };
    expect(rolloverVisitor(v, TODAY)).toEqual({ date: TODAY, count: 0 });

    const b: BudgetDayState = { date: YESTERDAY, reservedUsd: 0.4, settledUsd: 0.5 };
    expect(rolloverBudget(b, TODAY)).toEqual({ date: TODAY, reservedUsd: 0, settledUsd: 0 });
  });
});

describe("tryIncrementVisitor", () => {
  it("allows and increments under the limit", () => {
    const result = tryIncrementVisitor({ date: TODAY, count: 5 }, TODAY, NOW, 20);
    expect(result).toEqual({ ok: true, state: { date: TODAY, count: 6 } });
  });

  it("rejects at the limit and reports retryAfterSeconds", () => {
    const result = tryIncrementVisitor({ date: TODAY, count: 20 }, TODAY, NOW, 20);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("rolls a previous day's maxed-out count over to a fresh allowance", () => {
    const result = tryIncrementVisitor({ date: YESTERDAY, count: 20 }, TODAY, NOW, 20);
    expect(result).toEqual({ ok: true, state: { date: TODAY, count: 1 } });
  });
});

describe("tryReserve / release / settle", () => {
  it("reserves when there's room", () => {
    const result = tryReserve({ date: TODAY, reservedUsd: 0.1, settledUsd: 0.2 }, TODAY, NOW, 0.1, 0.5);
    expect(result).toEqual({ ok: true, state: { date: TODAY, reservedUsd: 0.2, settledUsd: 0.2 } });
  });

  it("rejects a reservation that would exceed the budget", () => {
    const result = tryReserve({ date: TODAY, reservedUsd: 0.1, settledUsd: 0.35 }, TODAY, NOW, 0.1, 0.5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("allows a reservation landing exactly on the budget", () => {
    const result = tryReserve({ date: TODAY, reservedUsd: 0, settledUsd: 0.4 }, TODAY, NOW, 0.1, 0.5);
    expect(result.ok).toBe(true);
  });

  it("release gives the reservation back without touching settled", () => {
    const state = release({ date: TODAY, reservedUsd: 0.3, settledUsd: 0.1 }, TODAY, 0.1);
    expect(state.date).toBe(TODAY);
    expect(state.reservedUsd).toBeCloseTo(0.2, 10);
    expect(state.settledUsd).toBeCloseTo(0.1, 10);
  });

  it("release never goes negative", () => {
    const state = release({ date: TODAY, reservedUsd: 0.05, settledUsd: 0 }, TODAY, 0.2);
    expect(state.reservedUsd).toBe(0);
  });

  it("settle moves a reservation into settled at the actual cost", () => {
    const state = settle({ date: TODAY, reservedUsd: 0.3, settledUsd: 0.1 }, TODAY, 0.3, 0.12);
    expect(state).toEqual({ date: TODAY, reservedUsd: 0, settledUsd: 0.22 });
  });

  it("reserve/release/settle all roll over a stale day first", () => {
    const stale: BudgetDayState = { date: YESTERDAY, reservedUsd: 0.49, settledUsd: 0 };
    expect(tryReserve(stale, TODAY, NOW, 0.1, 0.5)).toEqual({
      ok: true,
      state: { date: TODAY, reservedUsd: 0.1, settledUsd: 0 },
    });
    expect(release(stale, TODAY, 0.1)).toEqual({ date: TODAY, reservedUsd: 0, settledUsd: 0 });
    expect(settle(stale, TODAY, 0.1, 0.05)).toEqual({ date: TODAY, reservedUsd: 0, settledUsd: 0.05 });
  });
});
