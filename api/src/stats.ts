/**
 * Anonymous launch analytics (shared/stats.ts): daily totals only — no ids, no IPs, no
 * per-person records. Counts are spread over STATS_SHARDS docs per day
 * (system/stats-{date}-{shard}) and written with FieldValue.increment, so a traffic spike
 * doesn't serialize on one document; the admin view sums the shards.
 */
import {
  type AdminStatsResponse,
  type BeaconKind,
  COLLECTIONS,
  MAX_STATS_DAYS,
  type ServerStatKind,
  STATS_SHARDS,
  type StatsDay,
  statsDocId,
} from "@recipe/shared";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { type Logger, silentLogger } from "./log";
import { utcDateString } from "./time";

export type StatKind = BeaconKind | ServerStatKind;

const KINDS: StatKind[] = ["visit", "recipe_view", "explore_view", "captions_used", "signup", "recipe_created", "publish"];

/** Adds 1 to today's count of `kind` on a random shard. Throws on Firestore errors. */
export async function incrementStat(db: Firestore, kind: StatKind, now: Date, shard = Math.floor(Math.random() * STATS_SHARDS)): Promise<void> {
  const ref = db.collection(COLLECTIONS.system).doc(statsDocId(utcDateString(now), shard));
  await ref.set({ [kind]: FieldValue.increment(1) }, { merge: true });
}

/**
 * For server-side events (sign-up, recipe created, publish): analytics must never fail or
 * slow the request it describes, so errors are logged and swallowed.
 */
export async function countStat(db: Firestore, kind: ServerStatKind, now: Date, logger: Logger = silentLogger): Promise<void> {
  try {
    await incrementStat(db, kind, now);
  } catch (err) {
    logger.log("WARNING", "stat increment failed", { kind, error: err instanceof Error ? err.name : "unknown" });
  }
}

function emptyDay(date: string): StatsDay {
  return { date, visit: 0, recipe_view: 0, explore_view: 0, captions_used: 0, signup: 0, recipe_created: 0, publish: 0 };
}

/** UTC dates from `days - 1` days ago through today, oldest first. */
export function statsDates(now: Date, days: number): string[] {
  const n = Math.min(Math.max(1, Math.floor(days)), MAX_STATS_DAYS);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: n }, (_, i) => utcDateString(new Date(today - (n - 1 - i) * 86_400_000)));
}

export async function adminStats(db: Firestore, now: Date, days: number): Promise<AdminStatsResponse> {
  const dates = statsDates(now, days);
  const refs = dates.flatMap((d) =>
    Array.from({ length: STATS_SHARDS }, (_, s) => db.collection(COLLECTIONS.system).doc(statsDocId(d, s))),
  );
  const snaps = await db.getAll(...refs);
  const byDate = new Map(dates.map((d) => [d, emptyDay(d)]));
  snaps.forEach((snap, i) => {
    if (!snap.exists) return;
    const day = byDate.get(dates[Math.floor(i / STATS_SHARDS)]!)!;
    const data = snap.data() as Record<string, unknown>;
    for (const kind of KINDS) {
      const v = data[kind];
      if (typeof v === "number" && Number.isFinite(v)) day[kind] += v;
    }
  });
  return { days: dates.map((d) => byDate.get(d)!) };
}
