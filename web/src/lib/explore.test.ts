import { describe, expect, it } from "vitest";
import { EXPLORE_PAGE_SIZE } from "@recipe/shared";
import { REQUIRED_FILTERS, buildExploreQuery, matchesClientFilter } from "./explore";

describe("buildExploreQuery", () => {
  it("always filters live + public (required by firestore.rules)", () => {
    for (const params of [
      { tab: "newest" as const, search: "", tag: null },
      { tab: "popular" as const, search: "", tag: "vegan" },
      { tab: "popular" as const, search: "garlic noodles", tag: "chinese" },
    ]) {
      const spec = buildExploreQuery(params);
      expect(spec.filters.slice(0, 2)).toEqual(REQUIRED_FILTERS);
      expect(spec.filters).toContainEqual({ field: "status", op: "==", value: "live" });
      expect(spec.filters).toContainEqual({ field: "visibility", op: "==", value: "public" });
      expect(spec.limit).toBe(EXPLORE_PAGE_SIZE);
      // Firestore allows a single array-contains per query.
      expect(spec.filters.filter((f) => f.op === "array-contains").length).toBeLessThanOrEqual(1);
    }
  });

  it("Newest / Popular orderings", () => {
    expect(buildExploreQuery({ tab: "newest", search: "", tag: null }).orderBy).toEqual({ field: "publishedAt", direction: "desc" });
    expect(buildExploreQuery({ tab: "popular", search: "", tag: null }).orderBy).toEqual({ field: "stats.score", direction: "desc" });
  });

  it("a tag uses tags array-contains on the server (tags+score index for Popular)", () => {
    const spec = buildExploreQuery({ tab: "popular", search: "", tag: "vegan" });
    expect(spec.filters[2]).toEqual({ field: "tags", op: "array-contains", value: "vegan" });
    expect(spec.orderBy.field).toBe("stats.score");
    expect(spec.clientTag).toBeNull();
  });

  it("search: first word on the server, the rest (and the tag) in the browser, newest first", () => {
    const spec = buildExploreQuery({ tab: "popular", search: "The Garlic, NOODLES and chilli", tag: "chinese" });
    expect(spec.filters[2]).toEqual({ field: "terms", op: "array-contains", value: "garlic" });
    expect(spec.clientTerms).toEqual(["noodles", "chilli"]);
    expect(spec.clientTag).toBe("chinese");
    expect(spec.orderBy.field).toBe("publishedAt"); // no terms+score index
    expect(spec.sortedByNewestForSearch).toBe(true);
  });

  it("stop words only → no search filter", () => {
    const spec = buildExploreQuery({ tab: "newest", search: "the and a", tag: null });
    expect(spec.filters).toEqual(REQUIRED_FILTERS);
    expect(spec.clientTerms).toEqual([]);
  });

  it("dedupes and strips accents", () => {
    const spec = buildExploreQuery({ tab: "newest", search: "Crème crème brûlée", tag: null });
    expect(spec.filters[2].value).toBe("creme");
    expect(spec.clientTerms).toEqual(["brulee"]);
  });
});

describe("matchesClientFilter", () => {
  const doc = { terms: ["garlic", "noodles", "chilli", "chinese"], tags: ["chinese", "dinner"] };
  it("requires every remaining word (prefix on partial words) and the tag", () => {
    const spec = buildExploreQuery({ tab: "newest", search: "garlic nood", tag: "dinner" });
    expect(matchesClientFilter(doc, spec)).toBe(true);
    expect(matchesClientFilter(doc, buildExploreQuery({ tab: "newest", search: "garlic rice", tag: null }))).toBe(false);
    expect(matchesClientFilter(doc, buildExploreQuery({ tab: "newest", search: "garlic", tag: "vegan" }))).toBe(false);
  });
  it("passes everything when there's nothing to check client-side", () => {
    expect(matchesClientFilter(doc, buildExploreQuery({ tab: "newest", search: "", tag: "vegan" }))).toBe(true);
  });
});
