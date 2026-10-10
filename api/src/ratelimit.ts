/**
 * Per-UTC-day action counters (Phase 2 rate limits: publishes, likes/saves/copies, reports).
 * Stored as { day: "YYYY-MM-DD", count } — a different day means the count is 0, the same
 * rollover idea as the monthly quota (quota.ts). Pure transitions first, then helpers that
 * read/write a counter inside a caller's Firestore transaction.
 *
 * Where they live:
 *   users/{uid}.daily.{publishes|engagements|reports|suggestions}   per user (API-only doc)
 *   system/report-ip-{sha256(salt+ip)}                   per IP for reports (API-only)
 */
import type { DocumentReference, DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { appError } from "./errors";
import { secondsUntilNextUtcMidnight, utcDateString } from "./time";
import { newUserDoc, type UserProfile } from "./users";

export interface DayCount {
  day: string;
  count: number;
}

export type CountResult = { ok: true; state: DayCount } | { ok: false; retryAfterSeconds: number };

/** A stored counter, or undefined if absent/malformed (only the API writes these). */
export function readDayCount(value: unknown): DayCount | undefined {
  const v = value as Partial<DayCount> | null | undefined;
  if (!v || typeof v.day !== "string" || typeof v.count !== "number" || !Number.isInteger(v.count)) return undefined;
  return { day: v.day, count: v.count };
}

/** Starts a fresh zero count if `state` belongs to another day (or is absent). */
export function rolloverDay(state: DayCount | undefined, day: string): DayCount {
  if (state && state.day === day) return state;
  return { day, count: 0 };
}

/** Checks and increments today's count, or reports when it resets (next UTC midnight). */
export function tryCount(state: DayCount | undefined, now: Date, limit: number): CountResult {
  const current = rolloverDay(state, utcDateString(now));
  if (current.count >= limit) return { ok: false, retryAfterSeconds: secondsUntilNextUtcMidnight(now) };
  return { ok: true, state: { ...current, count: current.count + 1 } };
}

export type UserCounter = "publishes" | "engagements" | "reports" | "suggestions";

/** Counts one action against a user's daily limit or throws 429 rate_limited. Pure. */
export function countUserActionOrThrow(
  userSnap: DocumentSnapshot,
  counter: UserCounter,
  limit: number,
  now: Date,
): DayCount {
  const daily = (userSnap.data() as { daily?: Record<string, unknown> } | undefined)?.daily;
  const result = tryCount(readDayCount(daily?.[counter]), now, limit);
  if (!result.ok) throw appError("rate_limited", result.retryAfterSeconds);
  return result.state;
}

/**
 * The single write to users/{uid} for this transaction: update the counter (+ any extra
 * fields) on an existing doc, or create the doc from the token profile if it's the user's
 * first contact (a partial users doc would fail UserDoc validation later).
 */
export function writeUserFields(
  tx: Transaction,
  userRef: DocumentReference,
  userSnap: DocumentSnapshot,
  profile: UserProfile,
  now: Date,
  fields: { counter?: { name: UserCounter; state: DayCount }; extra?: Record<string, unknown> },
): void {
  const extra = fields.extra ?? {};
  if (userSnap.exists) {
    tx.update(userRef, {
      ...(fields.counter ? { [`daily.${fields.counter.name}`]: fields.counter.state } : {}),
      ...extra,
    });
  } else {
    tx.create(userRef, {
      ...newUserDoc(profile, now),
      ...(fields.counter ? { daily: { [fields.counter.name]: fields.counter.state } } : {}),
      ...extra,
    });
  }
}
