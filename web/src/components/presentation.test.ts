// Small presentational rules: warnings wording per audience, public recipe card meta line.
import { describe, expect, it } from "vitest";
import { PUBLIC_WARNINGS_INTRO, warningsSummary } from "./WarningsPanel";
import { cardFacts, showEngagementCounts } from "./public/PublicRecipeCard";
import { recipe } from "@/backend/cloud/testFixtures";

describe("warnings panel wording", () => {
  it("owner/private pages keep “things to double-check”", () => {
    expect(warningsSummary(3, "owner")).toBe("3 things to double-check");
    expect(warningsSummary(1, "owner")).toBe("1 thing to double-check");
  });
  it("public pages say “notes from the video”", () => {
    expect(warningsSummary(3, "public")).toBe("3 notes from the video");
    expect(warningsSummary(1, "public")).toBe("1 note from the video");
    expect(PUBLIC_WARNINGS_INTRO).toMatch(/^Things the video didn't say exactly/);
  });
});

describe("public recipe card", () => {
  it("shows total time (when known) and the ingredient count", () => {
    const r = recipe("Rice");
    expect(cardFacts(r)).toEqual(["1 ingredient"]);
    const many = { ...r, totalTimeMinutes: 30, ingredients: Array.from({ length: 17 }, () => r.ingredients[0]) };
    expect(cardFacts(many)).toEqual(["30 min", "17 ingredients"]);
    expect(cardFacts({ ...many, totalTimeMinutes: 90 })).toEqual(["1 hr 30 min", "17 ingredients"]);
    expect(cardFacts({ ...many, totalTimeMinutes: 0 })).toEqual(["17 ingredients"]);
  });
  it("hides like/save counts until either is above zero", () => {
    expect(showEngagementCounts({ likes: 0, saves: 0 })).toBe(false);
    expect(showEngagementCounts({ likes: 1, saves: 0 })).toBe(true);
    expect(showEngagementCounts({ likes: 0, saves: 2 })).toBe(true);
  });
});
