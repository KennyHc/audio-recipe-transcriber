/**
 * Pure state transitions for the per-visitor and global-budget counters.
 * Kept free of any Durable Object / storage API so they can be unit tested
 * directly; src/durableObjects/limiter.ts is the thin, stateful wrapper that
 * loads/saves these shapes from Durable Object storage.
 */
import { secondsUntilNextUtcMidnight } from "./rollover";

export interface VisitorDayState {
  date: string;
  count: number;
}

export interface BudgetDayState {
  date: string;
  reservedUsd: number;
  settledUsd: number;
}

export type LimitResult<S> =
  | { ok: true; state: S }
  | { ok: false; retryAfterSeconds: number };

/** Starts a fresh zero state if `state` belongs to a previous UTC day (or is absent). */
export function rolloverVisitor(state: VisitorDayState | undefined, today: string): VisitorDayState {
  if (state && state.date === today) return state;
  return { date: today, count: 0 };
}

export function rolloverBudget(state: BudgetDayState | undefined, today: string): BudgetDayState {
  if (state && state.date === today) return state;
  return { date: today, reservedUsd: 0, settledUsd: 0 };
}

/** Read-only: today's count for this visitor, without incrementing it. */
export function peekVisitorCount(state: VisitorDayState | undefined, today: string): number {
  return rolloverVisitor(state, today).count;
}

/** Atomically (from the caller's perspective) checks and increments the per-visitor daily count. */
export function tryIncrementVisitor(
  state: VisitorDayState | undefined,
  today: string,
  now: Date,
  limit: number,
): LimitResult<VisitorDayState> {
  const current = rolloverVisitor(state, today);
  if (current.count >= limit) {
    return { ok: false, retryAfterSeconds: secondsUntilNextUtcMidnight(now) };
  }
  return { ok: true, state: { ...current, count: current.count + 1 } };
}

/** Reserves `amountUsd` against the daily budget if there's room; otherwise reports when it resets. */
export function tryReserve(
  state: BudgetDayState | undefined,
  today: string,
  now: Date,
  amountUsd: number,
  budgetUsd: number,
): LimitResult<BudgetDayState> {
  const current = rolloverBudget(state, today);
  if (current.reservedUsd + current.settledUsd + amountUsd > budgetUsd) {
    return { ok: false, retryAfterSeconds: secondsUntilNextUtcMidnight(now) };
  }
  return { ok: true, state: { ...current, reservedUsd: current.reservedUsd + amountUsd } };
}

/** Releases a reservation that didn't result in a billed call (the upstream call failed). */
export function release(state: BudgetDayState | undefined, today: string, amountUsd: number): BudgetDayState {
  const current = rolloverBudget(state, today);
  return { ...current, reservedUsd: Math.max(0, current.reservedUsd - amountUsd) };
}

/** Replaces a reservation with the actual billed cost once the call completes. */
export function settle(
  state: BudgetDayState | undefined,
  today: string,
  reservedAmountUsd: number,
  actualAmountUsd: number,
): BudgetDayState {
  const current = rolloverBudget(state, today);
  return {
    ...current,
    reservedUsd: Math.max(0, current.reservedUsd - reservedAmountUsd),
    settledUsd: current.settledUsd + actualAmountUsd,
  };
}
