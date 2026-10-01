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
    await applyLimiterRequest(storage, { action: "release", amountUsd: 0.4 });
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
    await applyLimiterRequest(storage, { action: "settle", reservedAmountUsd: 0.4, actualAmountUsd: 0.1 });
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
