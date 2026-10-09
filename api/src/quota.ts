/**
 * Per-user monthly recipe quota, stored as users/{uid}.usage = { month, recipesCreated }.
 * A doc whose month isn't the current UTC month counts as 0 (same idea as the Worker's
 * rolloverVisitor, with months instead of days). Pure transitions only — the Firestore
 * transactions live in users.ts.
 */
import type { Usage } from "@recipe/shared";
import { nextUtcMonthStart, secondsUntilNextUtcMonth, utcMonthString } from "./time";

export interface UsageState {
  month: string;
  recipesCreated: number;
}

export type ConsumeResult = { ok: true; state: UsageState } | { ok: false; retryAfterSeconds: number };

/** Starts a fresh zero count if `state` belongs to another month (or is absent). */
export function rolloverUsage(state: UsageState | undefined, month: string): UsageState {
  if (state && state.month === month) return state;
  return { month, recipesCreated: 0 };
}

/** Checks and increments this month's count, or reports when the allowance resets. */
export function tryConsume(state: UsageState | undefined, now: Date, limit: number): ConsumeResult {
  const current = rolloverUsage(state, utcMonthString(now));
  if (current.recipesCreated >= limit) {
    return { ok: false, retryAfterSeconds: secondsUntilNextUtcMonth(now) };
  }
  return { ok: true, state: { ...current, recipesCreated: current.recipesCreated + 1 } };
}

/**
 * Gives back one recipe counted in `month` (the call failed on our side). If the month has
 * since rolled over, the count it came from is already gone — nothing to refund.
 */
export function refundUsage(state: UsageState | undefined, month: string): UsageState | null {
  if (!state || state.month !== month) return null;
  return { ...state, recipesCreated: Math.max(0, state.recipesCreated - 1) };
}

/** The client-facing view of a usage state as of `now`. */
export function toUsage(state: UsageState | undefined, now: Date, limit: number): Usage {
  const current = rolloverUsage(state, utcMonthString(now));
  return {
    month: current.month,
    used: current.recipesCreated,
    limit,
    remaining: Math.max(0, limit - current.recipesCreated),
    resetsAt: nextUtcMonthStart(now).toISOString(),
  };
}
