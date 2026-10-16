// Launch round: anonymous stats (POST /beacon, server counters, GET /admin/stats),
// schema.org JSON-LD on /r/:id, and /sitemap.xml.
import { AdminStatsResponse, STATS_SHARDS, statsDocId } from "@recipe/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetIndexCache } from "../../src/preview";
import { EXTRACTED, json, TRANSCRIPT } from "../fixtures";
import { call, closeAdmin, EMULATOR, harness, type Harness, resetEmulators, signUp, signUpAdmin, type TestUser } from "./harness";

const T0 = "2026-10-15T12:00:00.000Z"; // the harness clock
const DAY = T0.slice(0, 10);

async function dayTotals(h: Harness, date = DAY): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (let s = 0; s < STATS_SHARDS; s++) {
    const data = (await h.db.doc(`system/${statsDocId(date, s)}`).get()).data() ?? {};
    for (const [k, v] of Object.entries(data)) if (typeof v === "number") totals[k] = (totals[k] ?? 0) + v;
  }
  return totals;
}

describe.skipIf(!EMULATOR)("anonymous launch stats", () => {
  let h: Harness;
  let alice: TestUser;
  let admin: TestUser;

  beforeEach(async () => {
    await resetEmulators();
    h = harness();
    alice = await signUp("alice@example.com", "Alice");
    admin = await signUpAdmin("root@example.com");
  });
  afterAll(closeAdmin);

  it("counts beacons with no identity attached; rejects unknown kinds", async () => {
    for (const kind of ["visit", "visit", "recipe_view", "explore_view", "captions_used"]) {
      expect((await call(h, null, "POST", "/beacon", { kind })).status).toBe(204);
    }
    expect((await call(h, null, "POST", "/beacon", { kind: "purchase" })).status).toBe(400);
    expect(await dayTotals(h)).toEqual({ visit: 2, recipe_view: 1, explore_view: 1, captions_used: 1 });
    // Nothing but counters: no uid, IP, or user agent anywhere in the stats docs.
    const keys = new Set((await h.db.collection("system").get()).docs.flatMap((d) => Object.keys(d.data())));
    expect([...keys].sort()).toEqual(["captions_used", "explore_view", "recipe_view", "visit"]);
  });

  it("counts a sign-up once (first /me), a created recipe, and only the FIRST publish", async () => {
    await call(h, alice, "GET", "/me");
    await call(h, alice, "GET", "/me");
    const created = await call(h, alice, "POST", "/recipes", { id: "recipe-stat-01", fileName: "c.mp3", transcript: TRANSCRIPT });
    expect(created.status).toBe(201);
    // Idempotent re-POST: not a new recipe.
    await call(h, alice, "POST", "/recipes", { id: "recipe-stat-01", fileName: "c.mp3", transcript: TRANSCRIPT });
    const body = { visibility: "public", source: { kind: "own" }, tags: [], handle: "alice_cooks" };
    expect((await call(h, alice, "POST", "/recipes/recipe-stat-01/publish", body)).status).toBe(200);
    expect((await call(h, alice, "POST", "/recipes/recipe-stat-01/publish", body)).status).toBe(200); // update
    expect(await dayTotals(h)).toEqual({ signup: 1, recipe_created: 1, publish: 1 });
  });

  it("GET /admin/stats sums shards per day, fills empty days, admin only", async () => {
    await call(h, null, "POST", "/beacon", { kind: "visit" });
    await h.db.doc(`system/${statsDocId("2026-10-13", 3)}`).set({ visit: 5, signup: 1 });
    await h.db.doc(`system/${statsDocId("2026-10-13", 6)}`).set({ visit: 2 });

    expect((await call(h, alice, "GET", "/admin/stats?days=3")).status).toBe(403);
    expect((await call(h, admin, "GET", "/admin/stats?days=0")).status).toBe(400);
    expect((await call(h, admin, "GET", "/admin/stats?days=91")).status).toBe(400);

    const res = AdminStatsResponse.parse(await json(await call(h, admin, "GET", "/admin/stats?days=3")));
    expect(res.days.map((d) => [d.date, d.visit, d.signup])).toEqual([
      ["2026-10-13", 7, 1],
      ["2026-10-14", 0, 0],
      [DAY, 1, 0],
    ]);
  });
});

describe.skipIf(!EMULATOR)("search engines", () => {
  let h: Harness;
  beforeEach(async () => {
    await resetEmulators();
    resetIndexCache();
    h = harness();
  });
  afterAll(closeAdmin);

  const doc = (status: string, visibility = "public", extra: Record<string, unknown> = {}) => ({
    ownerId: "u1",
    handle: "chef_kim",
    visibility,
    status,
    recipe: { ...EXTRACTED, title: "Soup </script><b>", servings: 2, totalTimeMinutes: 30, warnings: [] },
    sourceVersion: 1,
    source: {
      kind: "video",
      platform: "youtube",
      videoId: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Soup",
      channelName: "Chef Kim",
      channelUrl: "https://www.youtube.com/@chefkim",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      startOffsetSeconds: 0,
    },
    tags: ["korean", "dinner"],
    terms: [],
    stats: { saves: 0, likes: 0, score: 0 },
    publishedAt: T0,
    updatedAt: T0,
    reviewReason: null,
    ...extra,
  });

  it("/r/:id carries a canonical link and schema.org Recipe JSON-LD that can't break out of <script>", async () => {
    await h.db.doc("publicRecipes/recipe-seo-001").set(doc("live"));
    const html = await (await h.app.request("/r/recipe-seo-001")).text();
    expect(html).toContain('<link rel="canonical" href="https://recipe-transcriber-eu.web.app/r/recipe-seo-001" />');
    const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]).not.toContain("</script>");
    const ld = JSON.parse(m![1]!);
    expect(ld).toMatchObject({
      "@type": "Recipe",
      name: "Soup </script><b>",
      author: { "@type": "Person", name: "Chef Kim" },
      totalTime: "PT30M",
      recipeYield: "2 servings",
      keywords: "korean, dinner",
      datePublished: "2026-10-15",
      isBasedOn: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(ld.recipeIngredient.length).toBe(EXTRACTED.ingredients.length);
    expect(ld.recipeInstructions[0]).toEqual({ "@type": "HowToStep", text: EXTRACTED.steps[0]!.text });
  });

  it("sitemap lists live public recipes and their creators only", async () => {
    await h.db.doc("publicRecipes/recipe-live-001").set(doc("live"));
    await h.db.doc("publicRecipes/recipe-unl-001").set(doc("live", "unlisted"));
    await h.db.doc("publicRecipes/recipe-rev-001").set(doc("review"));
    const res = await h.app.request("/sitemap.xml");
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain("<loc>https://recipe-transcriber-eu.web.app/r/recipe-live-001</loc><lastmod>2026-10-15</lastmod>");
    expect(xml).toContain("<loc>https://recipe-transcriber-eu.web.app/@chef_kim</loc>");
    expect(xml).not.toContain("recipe-unl-001");
    expect(xml).not.toContain("recipe-rev-001");
  });
});
