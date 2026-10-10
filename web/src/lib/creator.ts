// Creator pages (/@handle, cloud mode). Pure: describes the Firestore query, like lib/explore.ts;
// backend/cloud/publicBank.ts turns it into SDK calls.
//
// firebase/firestore.rules: list queries of publicRecipes must filter status == "live" AND
// visibility == "public" (an unlisted or in-review recipe never shows on a creator page).
// firebase/firestore.indexes.json: handle + status + visibility + publishedAt desc.

import { EXPLORE_PAGE_SIZE, Handle, type PublicRecipe } from "@recipe/shared";
import { REQUIRED_FILTERS } from "./explore";

export type CreatorFilter = { field: "status" | "visibility" | "handle"; op: "=="; value: string };

export interface CreatorQuerySpec {
  filters: CreatorFilter[];
  orderBy: { field: "publishedAt"; direction: "desc" };
  limit: number;
}

/** The handle from a /@handle URL, or null when it can't be one (no query is made then). */
export function normalizeHandleParam(raw: string): string | null {
  const h = raw.trim().replace(/^@/, "").toLowerCase();
  return Handle.safeParse(h).success ? h : null;
}

export function buildCreatorQuery(handle: string): CreatorQuerySpec {
  return {
    filters: [
      ...REQUIRED_FILTERS.map((f) => ({ field: f.field as "status" | "visibility", op: "==" as const, value: f.value })),
      { field: "handle", op: "==", value: handle },
    ],
    orderBy: { field: "publishedAt", direction: "desc" },
    limit: EXPLORE_PAGE_SIZE,
  };
}

export interface CreatorTotals {
  recipes: number;
  likes: number;
  saves: number;
}

/** Totals over the recipes we have (used when the server-side aggregate isn't available). */
export function sumCreatorStats(items: ReadonlyArray<Pick<PublicRecipe, "stats">>): CreatorTotals {
  return items.reduce<CreatorTotals>(
    (t, r) => ({ recipes: t.recipes + 1, likes: t.likes + r.stats.likes, saves: t.saves + r.stats.saves }),
    { recipes: 0, likes: 0, saves: 0 },
  );
}

/** "3 recipes · 12 likes · 4 saves" — zero likes/saves are left out (like the cards). */
export function creatorStatsLine(t: CreatorTotals, more = false): string {
  const parts = [`${t.recipes}${more ? "+" : ""} recipe${t.recipes === 1 && !more ? "" : "s"}`];
  if (t.likes > 0) parts.push(`${t.likes} like${t.likes === 1 ? "" : "s"}`);
  if (t.saves > 0) parts.push(`${t.saves} save${t.saves === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
