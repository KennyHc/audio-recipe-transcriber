/** UTC calendar bookkeeping for the monthly quota and the daily budget. */

/** "YYYY-MM-DD" for the UTC calendar day containing `now`. */
export function utcDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** "YYYY-MM" for the UTC calendar month containing `now`. */
export function utcMonthString(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** First instant of the UTC month after the one containing `now`. */
export function nextUtcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/** Seconds remaining until the next UTC month starts (always >= 1). */
export function secondsUntilNextUtcMonth(now: Date): number {
  return Math.max(1, Math.ceil((nextUtcMonthStart(now).getTime() - now.getTime()) / 1000));
}

/** Seconds remaining until the next UTC midnight after `now` (always >= 1). */
export function secondsUntilNextUtcMidnight(now: Date): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}
