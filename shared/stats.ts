import { z } from "zod";

// Launch analytics without tracking: daily totals only — no cookies, no user ids, no IPs, no
// per-visitor records. The browser sends an anonymous beacon at most once per page session
// per kind; the API counts server-side events (sign-ups, recipes, publishes) itself. Counts
// live in sharded docs system/stats-{YYYY-MM-DD}-{0..STATS_SHARDS-1} (increments, so a burst
// of traffic doesn't contend on one document) and are summed for the admin.
//
//   POST /beacon        BeaconRequest -> 204     App Check only (no account needed)
//   GET  /admin/stats?days=N  -> AdminStatsResponse   admin claim; N ≤ 90 (default 14)

export const STATS_SHARDS = 8;
export const statsDocId = (utcDate: string, shard: number) => `stats-${utcDate}-${shard}`;

/** What the browser may report. */
export const BeaconKind = z.enum([
  "visit", // a page session started (any page)
  "recipe_view", // a public recipe page (/r/{id}) was opened
  "explore_view", // Explore was opened
  "captions_used", // a recipe was started from pasted captions instead of audio
]);
export type BeaconKind = z.infer<typeof BeaconKind>;

export const BeaconRequest = z.object({ kind: BeaconKind });
export type BeaconRequest = z.infer<typeof BeaconRequest>;

/** Counted by the API itself. */
export const ServerStatKind = z.enum(["signup", "recipe_created", "publish"]);
export type ServerStatKind = z.infer<typeof ServerStatKind>;

export const StatsDay = z.object({
  date: z.string(), // UTC YYYY-MM-DD
  visit: z.number().int(),
  recipe_view: z.number().int(),
  explore_view: z.number().int(),
  captions_used: z.number().int(),
  signup: z.number().int(),
  recipe_created: z.number().int(),
  publish: z.number().int(),
});
export type StatsDay = z.infer<typeof StatsDay>;

export const AdminStatsResponse = z.object({
  days: z.array(StatsDay), // oldest first, one entry per day (zeros included)
});
export type AdminStatsResponse = z.infer<typeof AdminStatsResponse>;

export const MAX_STATS_DAYS = 90;
