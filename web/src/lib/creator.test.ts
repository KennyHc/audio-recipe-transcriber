import { describe, expect, it } from "vitest";
import { EXPLORE_PAGE_SIZE } from "@recipe/shared";
import { buildCreatorQuery, creatorStatsLine, normalizeHandleParam, sumCreatorStats } from "./creator";

describe("buildCreatorQuery", () => {
  it("filters live + public (required by firestore.rules) and the handle, newest first", () => {
    const spec = buildCreatorQuery("chef_ann");
    expect(spec.filters).toEqual([
      { field: "status", op: "==", value: "live" },
      { field: "visibility", op: "==", value: "public" },
      { field: "handle", op: "==", value: "chef_ann" },
    ]);
    // Matches the handle + status + visibility + publishedAt desc index.
    expect(spec.orderBy).toEqual({ field: "publishedAt", direction: "desc" });
    expect(spec.limit).toBe(EXPLORE_PAGE_SIZE);
  });
});

describe("normalizeHandleParam", () => {
  it("accepts handles from the URL, case-insensitively and with a stray @", () => {
    expect(normalizeHandleParam("chef_ann")).toBe("chef_ann");
    expect(normalizeHandleParam("Chef_Ann")).toBe("chef_ann");
    expect(normalizeHandleParam("@bob_bakes")).toBe("bob_bakes");
  });

  it("rejects anything that can't be a handle (no query is made)", () => {
    expect(normalizeHandleParam("")).toBeNull();
    expect(normalizeHandleParam("ab")).toBeNull();
    expect(normalizeHandleParam("bad!handle")).toBeNull();
    expect(normalizeHandleParam("a".repeat(21))).toBeNull();
  });
});

describe("creator stats", () => {
  const r = (likes: number, saves: number) => ({ stats: { likes, saves, score: likes + 2 * saves } });

  it("sums likes and saves over the recipes", () => {
    expect(sumCreatorStats([r(3, 1), r(4, 2), r(0, 0)])).toEqual({ recipes: 3, likes: 7, saves: 3 });
    expect(sumCreatorStats([])).toEqual({ recipes: 0, likes: 0, saves: 0 });
  });

  it("says it in one quiet line, leaving out zero likes/saves", () => {
    expect(creatorStatsLine({ recipes: 4, likes: 7, saves: 3 })).toBe("4 recipes · 7 likes · 3 saves");
    expect(creatorStatsLine({ recipes: 1, likes: 1, saves: 0 })).toBe("1 recipe · 1 like");
    expect(creatorStatsLine({ recipes: 2, likes: 0, saves: 0 })).toBe("2 recipes");
    expect(creatorStatsLine({ recipes: 24, likes: 0, saves: 1 }, true)).toBe("24+ recipes · 1 save");
  });
});
