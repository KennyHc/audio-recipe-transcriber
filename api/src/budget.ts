/**
 * Global daily Claude budget, kept in system/budget-YYYY-MM-DD (one doc per UTC day, so
 * "rollover" is just a new doc id). Pure transitions first — unit tested without Firestore —
 * then the thin transactional wrappers.
 *
 * Every call reserves its worst-case cost first, then settles to the actual cost (or
 * releases on failure). A Reservation carries the UTC day it was made on, and settle/release
 * always touch THAT day's doc: a call straddling midnight must not "release" money from the
 * new day that it never reserved there (a real bug we fixed in the Worker).
 */
import { BudgetDoc, budgetDocId, COLLECTIONS } from "@recipe/shared";
import type { Firestore } from "firebase-admin/firestore";
import { appError } from "./errors";
import { secondsUntilNextUtcMidnight, utcDateString } from "./time";

export interface BudgetState {
  reservedUsd: number;
  settledUsd: number;
}

export interface Reservation {
  /** UTC "YYYY-MM-DD" the amount was reserved against. */
  day: string;
  amountUsd: number;
}

const EMPTY: BudgetState = { reservedUsd: 0, settledUsd: 0 };

/** New state with `amountUsd` reserved, or null if it would go over `budgetUsd`. */
export function tryReserve(state: BudgetState | undefined, amountUsd: number, budgetUsd: number): BudgetState | null {
  const current = state ?? EMPTY;
  if (current.reservedUsd + current.settledUsd + amountUsd > budgetUsd) return null;
  return { ...current, reservedUsd: current.reservedUsd + amountUsd };
}

/** Releases a reservation that didn't result in a billed call. */
export function release(state: BudgetState | undefined, amountUsd: number): BudgetState {
  const current = state ?? EMPTY;
  return { ...current, reservedUsd: Math.max(0, current.reservedUsd - amountUsd) };
}

/** Replaces a reservation with the actual billed cost once the call completes. */
export function settle(state: BudgetState | undefined, reservedUsd: number, actualUsd: number): BudgetState {
  const current = state ?? EMPTY;
  return {
    reservedUsd: Math.max(0, current.reservedUsd - reservedUsd),
    settledUsd: current.settledUsd + actualUsd,
  };
}

function budgetRef(db: Firestore, day: string) {
  return db.collection(COLLECTIONS.system).doc(budgetDocId(day));
}

/** undefined = no doc yet (nothing spent today); null = malformed doc. */
function readState(data: unknown): BudgetState | undefined | null {
  if (data === undefined) return undefined;
  const parsed = BudgetDoc.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Reserves against today's budget or throws 503 budget_exhausted. */
export async function reserveBudgetOrThrow(
  db: Firestore,
  amountUsd: number,
  budgetUsd: number,
  now: Date,
): Promise<Reservation> {
  const day = utcDateString(now);
  const ref = budgetRef(db, day);
  const ok = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = readState(snap.data());
    // A malformed doc fails closed: treat the day as spent rather than empty.
    const next = state === null ? null : tryReserve(state, amountUsd, budgetUsd);
    if (!next) return false;
    tx.set(ref, next satisfies BudgetDoc);
    return true;
  });
  if (!ok) throw appError("budget_exhausted", secondsUntilNextUtcMidnight(now));
  return { day, amountUsd };
}

export async function settleReservation(db: Firestore, reservation: Reservation, actualUsd: number): Promise<void> {
  const ref = budgetRef(db, reservation.day);
  await db.runTransaction(async (tx) => {
    const state = readState((await tx.get(ref)).data());
    if (state === null) return; // malformed: leave it (and the day) blocked
    tx.set(ref, settle(state, reservation.amountUsd, actualUsd) satisfies BudgetDoc);
  });
}

export async function releaseReservation(db: Firestore, reservation: Reservation): Promise<void> {
  const ref = budgetRef(db, reservation.day);
  await db.runTransaction(async (tx) => {
    const state = readState((await tx.get(ref)).data());
    if (state === null) return;
    tx.set(ref, release(state, reservation.amountUsd) satisfies BudgetDoc);
  });
}
