/** UTC-day bookkeeping shared by the per-visitor and global-budget counters. */

/** "YYYY-MM-DD" for the UTC calendar day containing `now`. */
export function utcDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Seconds remaining until the next UTC midnight after `now` (always >= 1). */
export function secondsUntilNextUtcMidnight(now: Date): number {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  );
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}
