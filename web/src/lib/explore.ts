// Explore query building (cloud mode, Phase 2). Pure: it describes the Firestore query and the
// client-side filter; backend/cloud/publicStore.ts turns the description into SDK calls.
//
// What firebase/firestore.rules require: every list query of publicRecipes filters
// status == "live" AND visibility == "public" (otherwise the whole query is rejected).
// What firebase/firestore.indexes.json has (all after status + visibility):
//   publishedAt desc · stats.score desc · terms[] + publishedAt desc · tags[] + publishedAt desc ·
//   tags[] + stats.score desc.
// Firestore allows one array-contains per query, so a search uses the first search word on the
// server and filters the rest — and the tag — in the browser. With a search the order is always
// newest (there's no terms + score index).

import { EXPLORE_PAGE_SIZE, TAGS, searchWords, type PublicRecipe } from "@recipe/shared";

export type ExploreTab = "newest" | "popular";

export interface ExploreParams {
  tab: ExploreTab;
  search: string;
  tag: string | null;
}

export type ExploreFilter =
  | { field: "status" | "visibility"; op: "=="; value: string }
  | { field: "terms" | "tags"; op: "array-contains"; value: string };

export interface ExploreQuerySpec {
  filters: ExploreFilter[];
  orderBy: { field: "publishedAt" | "stats.score"; direction: "desc" };
  limit: number;
  /** Words every result must also contain (checked against `terms`), after the server's one. */
  clientTerms: string[];
  /** A tag checked in the browser (when the search already used the array-contains). */
  clientTag: string | null;
  /** True when Popular was asked for but a search forces newest-first. */
  sortedByNewestForSearch: boolean;
}

export const REQUIRED_FILTERS: ExploreFilter[] = [
  { field: "status", op: "==", value: "live" },
  { field: "visibility", op: "==", value: "public" },
];

export function buildExploreQuery(params: ExploreParams): ExploreQuerySpec {
  const words = [...new Set(searchWords(params.search))];
  const filters: ExploreFilter[] = [...REQUIRED_FILTERS];
  let clientTag: string | null = null;
  let order: ExploreQuerySpec["orderBy"]["field"] = params.tab === "popular" ? "stats.score" : "publishedAt";
  let sortedByNewestForSearch = false;

  if (words.length > 0) {
    filters.push({ field: "terms", op: "array-contains", value: words[0] });
    clientTag = params.tag;
    if (order === "stats.score") {
      order = "publishedAt";
      sortedByNewestForSearch = true;
    }
  } else if (params.tag) {
    filters.push({ field: "tags", op: "array-contains", value: params.tag });
  }

  return {
    filters,
    orderBy: { field: order, direction: "desc" },
    limit: EXPLORE_PAGE_SIZE,
    clientTerms: words.slice(1),
    clientTag,
    sortedByNewestForSearch,
  };
}

/** The browser-side half of the query: remaining search words (prefix match on the last one,
 * so "chick" finds "chicken" as you type) and the tag when it wasn't the server filter. */
export function matchesClientFilter(recipe: Pick<PublicRecipe, "terms" | "tags">, spec: ExploreQuerySpec): boolean {
  if (spec.clientTag && !recipe.tags.includes(spec.clientTag)) return false;
  return spec.clientTerms.every((word) => recipe.terms.some((t) => t === word || t.startsWith(word)));
}

/** True when the query is the plain, unfiltered list (the default Explore view). */
export function isDefaultExplore(params: ExploreParams): boolean {
  return params.search.trim() === "" && params.tag === null;
}

export type TagGroup = keyof typeof TAGS;
export const TAG_GROUPS = Object.keys(TAGS) as TagGroup[];

/** Which filter dropdown (Cuisine / Meal / Diet) a tag lives in; null for an unknown tag. */
export function tagGroupOf(tag: string | null): TagGroup | null {
  if (!tag) return null;
  return TAG_GROUPS.find((g) => (TAGS[g] as readonly string[]).includes(tag)) ?? null;
}

/**
 * What a filter dropdown's button says: the picked tag when it lives in this group ("Chinese"),
 * otherwise the group's name ("Cuisine"). Labels are passed in so this stays free of UI copy.
 */
export function tagFilterButtonLabel(
  group: TagGroup,
  tag: string | null,
  labels: { group: (g: TagGroup) => string; tag: (t: string) => string },
): { text: string; active: boolean } {
  return tagGroupOf(tag) === group && tag ? { text: labels.tag(tag), active: true } : { text: labels.group(group), active: false };
}

/** The empty-state copy for the current filters. */
export function exploreEmptyMessage(params: ExploreParams): { title: string; hint: string } {
  return isDefaultExplore(params)
    ? { title: "No public recipes yet", hint: "Published recipes will show up here." }
    : { title: "No recipes match", hint: "Try another word or filter." };
}
