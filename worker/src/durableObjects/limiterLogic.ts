import {
  type BudgetDayState,
  type VisitorDayState,
  release,
  settle,
  tryIncrementVisitor,
  tryReserve,
} from "../budget";
import { utcDateString } from "../rollover";
import type { LimiterRequest, LimiterResponse } from "./protocol";

/** The subset of DurableObjectStorage this logic needs — narrow on purpose so it's easy to fake in tests. */
export interface MinimalStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

function visitorKey(date: string, visitorId: string): string {
  return `visitor:${date}:${visitorId}`;
}

function budgetKey(date: string): string {
  return `budget:${date}`;
}

/**
 * Applies one LimiterRequest against durable storage and returns the result.
 * Each case is a single get -> pure transition -> put. Durable Objects only
 * deliver one event at a time to a given object by default (new events are
 * held behind the "input gate" while storage operations from the current
 * event are in flight), so this get-then-put is atomic with respect to other
 * concurrent requests to the same object without needing an explicit
 * transaction.
 * https://developers.cloudflare.com/durable-objects/reference/in-memory-state/#input-gate
 */
export async function applyLimiterRequest(
  storage: MinimalStorage,
  request: LimiterRequest,
): Promise<LimiterResponse> {
  switch (request.action) {
    case "incrementVisitor": {
      const now = new Date(request.nowMs);
      const today = utcDateString(now);
      const key = visitorKey(today, request.visitorId);
      const current = await storage.get<VisitorDayState>(key);
      const result = tryIncrementVisitor(current, today, now, request.limit);
      if (!result.ok) return result;
      await storage.put(key, result.state);
      return { ok: true };
    }

    case "reserve": {
      const now = new Date(request.nowMs);
      const today = utcDateString(now);
      const key = budgetKey(today);
      const current = await storage.get<BudgetDayState>(key);
      const result = tryReserve(current, today, now, request.amountUsd, request.budgetUsd);
      if (!result.ok) return result;
      await storage.put(key, result.state);
      return { ok: true };
    }

    case "release": {
      const key = budgetKey(request.day);
      const current = await storage.get<BudgetDayState>(key);
      await storage.put(key, release(current, request.day, request.amountUsd));
      return { ok: true };
    }

    case "settle": {
      const key = budgetKey(request.day);
      const current = await storage.get<BudgetDayState>(key);
      await storage.put(
        key,
        settle(current, request.day, request.reservedAmountUsd, request.actualAmountUsd),
      );
      return { ok: true };
    }
  }
}
