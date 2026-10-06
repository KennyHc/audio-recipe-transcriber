import { describe, expect, it } from "vitest";
import { applyLimiterRequest, type MinimalStorage } from "../src/durableObjects/limiterLogic";

function fakeStorage(): MinimalStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      data.set(key, value);
    },
  };
}

const NOW_MS = new Date("2026-10-01T12:00:00.000Z").getTime();

describe("applyLimiterRequest: incrementVisitor", () => {
  it("allows and persists increments up to the limit", async () => {
    const storage = fakeStorage();
    for (let i = 0; i < 3; i++) {
      const result = await applyLimiterRequest(storage, {
        action: "incrementVisitor",
        visitorId: "v1",
        limit: 3,
        nowMs: NOW_MS,
      });
      expect(result.ok).toBe(true);
    }
    const blocked = await applyLimiterRequest(storage, {
      action: "incrementVisitor",
      visitorId: "v1",
      limit: 3,
      nowMs: NOW_MS,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks separate visitors independently", async () => {
    const storage = fakeStorage();
    await applyLimiterRequest(storage, { action: "incrementVisitor", visitorId: "v1", limit: 1, nowMs: NOW_MS });
    const other = await applyLimiterRequest(storage, {
      action: "incrementVisitor",
      visitorId: "v2",
      limit: 1,
      nowMs: NOW_MS,
    });
    expect(other.ok).toBe(true);
  });
});

describe("applyLimiterRequest: peekVisitor", () => {
  it("reports 0 for a visitor that has never incremented", async () => {
    const storage = fakeStorage();
    const result = await applyLimiterRequest(storage, { action: "peekVisitor", visitorId: "v1", nowMs: NOW_MS });
    expect(result.ok).toBe(true);
    if (result.ok && "count" in result) expect(result.count).toBe(0);
  });

  it("reflects increments without itself incrementing", async () => {
    const storage = fakeStorage();
    await applyLimiterRequest(storage, { action: "incrementVisitor", visitorId: "v1", limit: 20, nowMs: NOW_MS });
    await applyLimiterRequest(storage, { action: "incrementVisitor", visitorId: "v1", limit: 20, nowMs: NOW_MS });

    const first = await applyLimiterRequest(storage, { action: "peekVisitor", visitorId: "v1", nowMs: NOW_MS });
    const second = await applyLimiterRequest(storage, { action: "peekVisitor", visitorId: "v1", nowMs: NOW_MS });
    if (first.ok && "count" in first) expect(first.count).toBe(2);
    if (second.ok && "count" in second) expect(second.count).toBe(2); // unchanged by the peek itself
  });

  it("rolls over to 0 on a new UTC day", async () => {
    const storage = fakeStorage();
    await applyLimiterRequest(storage, { action: "incrementVisitor", visitorId: "v1", limit: 20, nowMs: NOW_MS });
    const nextDayMs = new Date("2026-10-02T00:00:01.000Z").getTime();
    const result = await applyLimiterRequest(storage, { action: "peekVisitor", visitorId: "v1", nowMs: nextDayMs });
    if (result.ok && "count" in result) expect(result.count).toBe(0);
  });
});

describe("applyLimiterRequest: reserve/release/settle", () => {
  it("reserve fails once the budget would be exceeded", async () => {
    const storage = fakeStorage();
    const first = await applyLimiterRequest(storage, {
      action: "reserve",
      amountUsd: 0.3,
      budgetUsd: 0.5,
      nowMs: NOW_MS,
    });
    expect(first.ok).toBe(true);
    const second = await applyLimiterRequest(storage, {
      action: "reserve",
      amountUsd: 0.3,
      budgetUsd: 0.5,
      nowMs: NOW_MS,
    });
    expect(second.ok).toBe(false);
  });

  it("release frees budget back up for a later reservation", async () => {
    const storage = fakeStorage();
    await applyLimiterRequest(storage, { action: "reserve", amountUsd: 0.4, budgetUsd: 0.5, nowMs: NOW_MS });
    await applyLimiterRequest(storage, { action: "release", amountUsd: 0.4, day: "2026-10-01" });
    const after = await applyLimiterRequest(storage, {
      action: "reserve",
      amountUsd: 0.4,
      budgetUsd: 0.5,
      nowMs: NOW_MS,
    });
    expect(after.ok).toBe(true);
  });

  it("settle moves the reservation into settled spend", async () => {
    const storage = fakeStorage();
    await applyLimiterRequest(storage, { action: "reserve", amountUsd: 0.4, budgetUsd: 0.5, nowMs: NOW_MS });
    await applyLimiterRequest(storage, { action: "settle", reservedAmountUsd: 0.4, actualAmountUsd: 0.1, day: "2026-10-01" });
    // 0.1 settled + a new 0.4 reservation = 0.5, right at budget.
    const after = await applyLimiterRequest(storage, {
      action: "reserve",
      amountUsd: 0.4,
      budgetUsd: 0.5,
      nowMs: NOW_MS,
    });
    expect(after.ok).toBe(true);
    const overBudget = await applyLimiterRequest(storage, {
      action: "reserve",
      amountUsd: 0.01,
      budgetUsd: 0.5,
      nowMs: NOW_MS,
    });
    expect(overBudget.ok).toBe(false);
  });

  it("budget resets on a new UTC day", async () => {
    const storage = fakeStorage();
    await applyLimiterRequest(storage, { action: "reserve", amountUsd: 0.5, budgetUsd: 0.5, nowMs: NOW_MS });
    const nextDayMs = new Date("2026-10-02T00:00:01.000Z").getTime();
    const result = await applyLimiterRequest(storage, {
      action: "reserve",
      amountUsd: 0.5,
      budgetUsd: 0.5,
      nowMs: nextDayMs,
    });
    expect(result.ok).toBe(true);
  });
});

describe("reservations that cross UTC midnight", () => {
  it("release/settle hit the reservation's own day, leaving the new day's budget untouched", async () => {
    const storage = fakeStorage();
    const beforeMidnight = new Date("2026-10-01T23:59:59.000Z").getTime();
    const afterMidnight = new Date("2026-10-02T00:00:05.000Z").getTime();

    await applyLimiterRequest(storage, { action: "reserve", amountUsd: 0.4, budgetUsd: 0.5, nowMs: beforeMidnight });
    // The Claude call finishes after midnight; settle/release still target 2026-10-01.
    await applyLimiterRequest(storage, { action: "settle", reservedAmountUsd: 0.4, actualAmountUsd: 0.1, day: "2026-10-01" });
    await applyLimiterRequest(storage, { action: "release", amountUsd: 0.4, day: "2026-10-01" });

    // The new day still has exactly its full budget: 0.5 fits, anything more doesn't.
    const full = await applyLimiterRequest(storage, { action: "reserve", amountUsd: 0.5, budgetUsd: 0.5, nowMs: afterMidnight });
    expect(full.ok).toBe(true);
    const over = await applyLimiterRequest(storage, { action: "reserve", amountUsd: 0.01, budgetUsd: 0.5, nowMs: afterMidnight });
    expect(over.ok).toBe(false);
  });
});
