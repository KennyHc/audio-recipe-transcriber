// Phase 2 (shared/public.ts) against the Firestore + Auth emulators, with a fake Claude and
// a fake fetch (no network).
import {
  AdminQueueResponse,
  budgetDocId,
  CopyResponse,
  EngagementResponse,
  MAX_ENGAGEMENTS_PER_DAY,
  MAX_PUBLISHES_PER_DAY,
  MAX_REPORTS_PER_DAY,
  type PublicRecipeDoc,
  PublishResponse,
  type Recipe,
  type RecipeDoc,
  type ReportDoc,
  SourcePreview,
} from "@recipe/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EXTRACTED, json } from "../fixtures";
import {
  call,
  closeAdmin,
  EMULATOR,
  harness,
  resetEmulators,
  signUp,
  signUpAdmin,
  type Harness,
  type TestUser,
} from "./harness";

const VID = "dQw4w9WgXcQ";
const VID2 = "abcdefghijk";
const T0 = "2026-10-15T12:00:00.000Z";

const ytSource = (id = VID, startOffsetSeconds = 0) => ({
  kind: "video" as const,
  url: `https://youtu.be/${id}`,
  creditName: null,
  startOffsetSeconds,
});

function recipeWith(title: string): Recipe {
  return { ...EXTRACTED, title, warnings: [] };
}

/** A private recipe as the API/import would have written it. */
async function seedRecipe(h: Harness, uid: string, id: string, title = "Egg Fried Rice", version = 1): Promise<Recipe> {
  const recipe = recipeWith(title);
  const doc: RecipeDoc = {
    ownerId: uid,
    visibility: "private",
    title,
    fileName: "clip.mp3",
    createdAt: T0,
    updatedAt: T0,
    currentVersion: version,
    latest: recipe,
  };
  await h.db.doc(`recipes/${id}`).set(doc);
  await h.db.doc(`recipes/${id}/versions/${version}`).set({
    meta: { version, source: version === 1 ? "extracted" : "edited", createdAt: T0, note: null },
    recipe,
  });
  return recipe;
}

function publish(h: Harness, user: TestUser, id: string, body: Record<string, unknown> = {}) {
  return call(h, user, "POST", `/recipes/${id}/publish`, {
    visibility: "public",
    source: ytSource(),
    tags: ["chinese", "dinner"],
    handle: "alice_cooks",
    ...body,
  });
}

async function publicDoc(h: Harness, id: string): Promise<PublicRecipeDoc | undefined> {
  return (await h.db.doc(`publicRecipes/${id}`).get()).data() as PublicRecipeDoc | undefined;
}

async function reports(h: Harness): Promise<Array<ReportDoc & { id: string }>> {
  const snap = await h.db.collection("reports").get();
  return snap.docs.map((d) => ({ ...(d.data() as ReportDoc), id: d.id }));
}

describe.skipIf(!EMULATOR)("POST /recipes/:id/publish", () => {
  let h: Harness;
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    await resetEmulators();
    h = harness();
    alice = await signUp("alice@example.com", "Alice");
    bob = await signUp("bob@example.com", "Bob");
  });
  afterAll(closeAdmin);

  it("publishes a YouTube recipe with oEmbed credit, reserving the handle (happy path)", async () => {
    const recipe = await seedRecipe(h, alice.uid, "recipe-a-0001");
    const res = await publish(h, alice, "recipe-a-0001", { source: ytSource(VID, 95) });
    expect(res.status).toBe(200);
    const { publicRecipe } = PublishResponse.parse(await json(res));

    expect(publicRecipe).toEqual({
      id: "recipe-a-0001",
      ownerId: alice.uid,
      handle: "alice_cooks",
      visibility: "public",
      status: "live",
      recipe,
      sourceVersion: 1,
      source: {
        kind: "video",
        platform: "youtube",
        videoId: VID,
        url: `https://www.youtube.com/watch?v=${VID}`,
        title: `Fried rice video ${VID}`,
        channelName: "Chef YouTube",
        channelUrl: "https://www.youtube.com/@chef",
        thumbnailUrl: `https://i.ytimg.com/vi/${VID}/hqdefault.jpg`,
        startOffsetSeconds: 95,
      },
      tags: ["chinese", "dinner"],
      terms: ["egg", "fried", "rice", "eggs", "chinese", "dinner"],
      stats: { saves: 0, likes: 0, score: 0 },
      publishedAt: T0,
      updatedAt: T0,
    });
    const { id: _id, ...stored } = publicRecipe;
    expect(await publicDoc(h, "recipe-a-0001")).toEqual(stored);
    expect((await h.db.doc(`sources/youtube:${VID}`).get()).data()).toEqual({ publicRecipeId: "recipe-a-0001" });
    expect((await h.db.doc("handles/alice_cooks").get()).data()).toEqual({ uid: alice.uid });

    const userDoc = (await h.db.doc(`users/${alice.uid}`).get()).data();
    expect(userDoc?.handle).toBe("alice_cooks");
    expect(userDoc?.daily?.publishes).toEqual({ day: "2026-10-15", count: 1 });
    expect(userDoc?.usage).toEqual({ month: "2026-10", recipesCreated: 0 }); // quota untouched
    expect((await h.db.doc("recipes/recipe-a-0001").get()).data()?.visibility).toBe("public");

    // Screening ran once, against the global budget (settled), on the public text only.
    expect(h.claude.screenCalls).toBe(1);
    expect(h.claude.screened[0]).toContain("Egg Fried Rice");
    expect(h.claude.screened[0]).toContain("@alice_cooks");
    const budget = (await h.db.doc(`system/${budgetDocId("2026-10-15")}`).get()).data();
    expect(budget?.reservedUsd).toBeCloseTo(0, 12);
    expect(budget?.settledUsd).toBeGreaterThan(0);

    // The only outgoing request: YouTube's oEmbed endpoint.
    expect(h.fetch.calls).toHaveLength(1);
    expect(h.fetch.calls[0]).toMatch(/^https:\/\/www\.youtube\.com\/oembed\?url=/);

    // GET /me now reports the handle.
    const me = await json(await call(h, alice, "GET", "/me"));
    expect(me).toMatchObject({ handle: "alice_cooks", isAdmin: false });
  });

  it("publishes TikTok via a short link", async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    h.fetch.redirects.set("https://vm.tiktok.com/ZMabc/", "https://www.tiktok.com/@cheftok/video/7212345678901234567?_r=1");
    const res = await publish(h, alice, "recipe-a-0001", {
      source: { kind: "video", url: "https://vm.tiktok.com/ZMabc/", creditName: "ignored", startOffsetSeconds: 0 },
    });
    expect(res.status).toBe(200);
    const { publicRecipe } = PublishResponse.parse(await json(res));
    expect(publicRecipe.source).toMatchObject({
      kind: "video",
      platform: "tiktok",
      videoId: "7212345678901234567",
      url: "https://www.tiktok.com/@cheftok/video/7212345678901234567",
      channelName: "Chef TikTok", // oEmbed wins over a typed name
    });
    expect((await h.db.doc("sources/tiktok:7212345678901234567").get()).exists).toBe(true);
  });

  it("publishes 'my own recipe' and 'somewhere else' with the typed credit", async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    await seedRecipe(h, alice.uid, "recipe-a-0002", "Dan Dan Noodles");
    await seedRecipe(h, alice.uid, "recipe-a-0003", "Mapo Tofu");

    const own = PublishResponse.parse(await json(await publish(h, alice, "recipe-a-0001", { source: { kind: "own" } })));
    expect(own.publicRecipe.source).toEqual({
      kind: "own",
      platform: null,
      videoId: null,
      url: null,
      title: null,
      channelName: null,
      channelUrl: null,
      thumbnailUrl: null,
      startOffsetSeconds: 0,
    });

    const other = PublishResponse.parse(
      await json(
        await publish(h, alice, "recipe-a-0002", {
          source: { kind: "other", url: "https://example.com/dan-dan#top", creditName: "Grandma Li" },
          handle: null, // already has one
        }),
      ),
    );
    expect(other.publicRecipe.handle).toBe("alice_cooks");
    expect(other.publicRecipe.source).toMatchObject({
      kind: "other",
      platform: "other",
      videoId: null,
      url: "https://example.com/dan-dan",
      channelName: "Grandma Li",
    });

    // A video on another site needs the typed name.
    const noName = await publish(h, alice, "recipe-a-0003", {
      source: { kind: "video", url: "https://www.instagram.com/reel/Cabc/", creditName: null, startOffsetSeconds: 3 },
    });
    expect(noName.status).toBe(400);
    const named = await publish(h, alice, "recipe-a-0003", {
      source: { kind: "video", url: "https://www.instagram.com/reel/Cabc/", creditName: "chef.gram", startOffsetSeconds: 3 },
    });
    expect(PublishResponse.parse(await json(named)).publicRecipe.source).toMatchObject({
      kind: "video",
      platform: "other",
      channelName: "chef.gram",
      startOffsetSeconds: 3,
    });
    // No mapping for non-YouTube/TikTok sources; nothing fetched for them.
    expect((await h.db.collection("sources").get()).size).toBe(0);
    expect(h.fetch.calls).toEqual([]);
  });

  it("treats a YouTube link given as 'somewhere else' as the video (credit from oEmbed)", async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    const res = await publish(h, alice, "recipe-a-0001", {
      source: { kind: "other", url: `https://www.youtube.com/watch?v=${VID}`, creditName: "Fake Name" },
    });
    expect(PublishResponse.parse(await json(res)).publicRecipe.source).toMatchObject({
      kind: "video",
      platform: "youtube",
      channelName: "Chef YouTube",
    });
  });

  it("requires a handle on the first publish, without counting it", async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    const res = await publish(h, alice, "recipe-a-0001", { handle: null });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("bad_request");
    expect(await publicDoc(h, "recipe-a-0001")).toBeUndefined();
    expect((await h.db.doc(`users/${alice.uid}`).get()).data()?.daily).toBeUndefined();
    expect(h.claude.screenCalls).toBe(0);
  });

  it("409 handle_taken when the handle belongs to someone else; own handle is fixed", async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    await seedRecipe(h, bob.uid, "recipe-b-0001", "Bob's Rice");
    expect((await publish(h, alice, "recipe-a-0001")).status).toBe(200);

    const res = await publish(h, bob, "recipe-b-0001", { handle: "alice_cooks", source: ytSource(VID2) });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe("handle_taken");
    expect((await h.db.doc(`users/${bob.uid}`).get()).data()?.handle).toBeUndefined();

    // Alice can't switch handles: a different one in the request is ignored.
    const again = await publish(h, alice, "recipe-a-0001", { handle: "new_name" });
    expect(PublishResponse.parse(await json(again)).publicRecipe.handle).toBe("alice_cooks");
    expect((await h.db.doc("handles/new_name").get()).exists).toBe(false);
  });

  it("409 duplicate_video for a second public page of the same video; unlisted is allowed", async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    await seedRecipe(h, bob.uid, "recipe-b-0001", "Bob's Rice");
    expect((await publish(h, alice, "recipe-a-0001")).status).toBe(200);

    // The preview already tells Bob.
    const preview = SourcePreview.parse(
      await json(await call(h, bob, "GET", `/sources/preview?url=${encodeURIComponent(`https://youtu.be/${VID}`)}`)),
    );
    expect(preview).toMatchObject({ platform: "youtube", videoId: VID, existingPublicId: "recipe-a-0001", channelName: "Chef YouTube" });

    const screensBefore = h.claude.screenCalls;
    const dup = await publish(h, bob, "recipe-b-0001", { handle: "bob_eats" });
    expect(dup.status).toBe(409);
    expect(await json(dup)).toEqual({
      error: expect.any(String),
      code: "duplicate_video",
      retryAfterSeconds: null,
      existingPublicId: "recipe-a-0001",
    });
    expect(h.claude.screenCalls).toBe(screensBefore); // no screening spent on a duplicate
    expect(await publicDoc(h, "recipe-b-0001")).toBeUndefined();

    const unlisted = await publish(h, bob, "recipe-b-0001", { handle: "bob_eats", visibility: "unlisted" });
    expect(unlisted.status).toBe(200);
    expect((await publicDoc(h, "recipe-b-0001"))?.visibility).toBe("unlisted");
    // The unlisted copy doesn't claim the video.
    expect((await h.db.doc(`sources/youtube:${VID}`).get()).data()).toEqual({ publicRecipeId: "recipe-a-0001" });
  });

  it("allows a public page for a video whose existing page isn't live", async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    await seedRecipe(h, bob.uid, "recipe-b-0001", "Bob's Rice");
    await publish(h, alice, "recipe-a-0001");
    await h.db.doc("publicRecipes/recipe-a-0001").update({ status: "hidden" });

    const res = await publish(h, bob, "recipe-b-0001", { handle: "bob_eats" });
    expect(res.status).toBe(200);
    expect((await h.db.doc(`sources/youtube:${VID}`).get()).data()).toEqual({ publicRecipeId: "recipe-b-0001" });
  });

  it("update re-snapshots the private latest, keeps stats + publishedAt, and moves the source mapping", async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    await publish(h, alice, "recipe-a-0001");
    await h.db.doc("publicRecipes/recipe-a-0001").update({ stats: { likes: 4, saves: 2, score: 8 } });

    // An edit saved privately (v2) — not public until "Update public version".
    const edited = recipeWith("Better Egg Fried Rice");
    await h.db.doc("recipes/recipe-a-0001").update({ latest: edited, title: edited.title, currentVersion: 2 });
    expect((await publicDoc(h, "recipe-a-0001"))?.recipe.title).toBe("Egg Fried Rice");

    h.clock.set("2026-10-16T09:30:00Z");
    const res = await publish(h, alice, "recipe-a-0001", { source: ytSource(VID2), tags: ["vegetarian"] });
    const { publicRecipe } = PublishResponse.parse(await json(res));
    expect(publicRecipe).toMatchObject({
      recipe: edited,
      sourceVersion: 2,
      stats: { likes: 4, saves: 2, score: 8 },
      publishedAt: T0,
      updatedAt: "2026-10-16T09:30:00.000Z",
      tags: ["vegetarian"],
      status: "live",
    });
    expect(publicRecipe.terms).toContain("better");
    expect((await h.db.doc(`sources/youtube:${VID}`).get()).exists).toBe(false);
    expect((await h.db.doc(`sources/youtube:${VID2}`).get()).data()).toEqual({ publicRecipeId: "recipe-a-0001" });

    // Switching to unlisted drops the mapping too.
    await publish(h, alice, "recipe-a-0001", { source: ytSource(VID2), visibility: "unlisted" });
    expect((await h.db.doc(`sources/youtube:${VID2}`).get()).exists).toBe(false);
    expect((await h.db.doc("recipes/recipe-a-0001").get()).data()?.visibility).toBe("unlisted");
  });

  it("screening 'review' → status review + a screening report + publish_flagged log", async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    h.claude.onScreen = async () => ({
      output: { decision: "review", reason: "Looks like an advert." },
      usage: { inputTokens: 500, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    const res = await publish(h, alice, "recipe-a-0001");
    expect(PublishResponse.parse(await json(res)).publicRecipe.status).toBe("review");

    const [report, ...rest] = await reports(h);
    expect(rest).toEqual([]);
    expect(report).toMatchObject({
      publicRecipeId: "recipe-a-0001",
      kind: "screening",
      reason: "Looks like an advert.",
      contact: null,
      reporterUid: null,
      status: "open",
      createdAt: T0,
      resolvedAt: null,
      resolution: null,
    });
    const flagged = h.logs.filter((l) => l.fields.event === "publish_flagged");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.fields).toMatchObject({ publicRecipeId: "recipe-a-0001", screening: "review" });
    expect(JSON.stringify(h.logs)).not.toContain("advert");
  });

  it("fails safe to review when the daily budget is exhausted (no Claude call)", async () => {
    h = harness({ dailyBudgetUsd: 0 });
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    const res = await publish(h, alice, "recipe-a-0001");
    expect(res.status).toBe(200);
    expect(PublishResponse.parse(await json(res)).publicRecipe.status).toBe("review");
    expect(h.claude.screenCalls).toBe(0);
    expect((await reports(h))[0]).toMatchObject({ kind: "screening", reason: "screening unavailable" });
    expect(h.logs.find((l) => l.fields.event === "publish_flagged")?.fields.screening).toBe("unavailable");
  });

  it("fails safe to review when the screening call errors, releasing the budget", async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    h.claude.onScreen = async () => {
      throw new Error("anthropic 529 overloaded");
    };
    const res = await publish(h, alice, "recipe-a-0001");
    expect(PublishResponse.parse(await json(res)).publicRecipe.status).toBe("review");
    expect((await reports(h))[0]?.reason).toBe("screening unavailable");
    expect((await h.db.doc(`system/${budgetDocId("2026-10-15")}`).get()).data()).toEqual({ reservedUsd: 0, settledUsd: 0 });
  });

  it("keeps an admin-hidden recipe hidden on update", async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    await publish(h, alice, "recipe-a-0001");
    await h.db.doc("publicRecipes/recipe-a-0001").update({ status: "hidden" });
    const res = await publish(h, alice, "recipe-a-0001");
    expect(PublishResponse.parse(await json(res)).publicRecipe.status).toBe("hidden");
  });

  it("404s for someone else's recipe or a missing one; 422 for an unavailable video", async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    expect((await publish(h, bob, "recipe-a-0001", { handle: "bob_eats" })).status).toBe(404);
    expect((await publish(h, alice, "recipe-zzzz-404")).status).toBe(404);

    h.fetch.oembedStatus.set(VID, 401);
    const res = await publish(h, alice, "recipe-a-0001");
    expect(res.status).toBe(422);
    expect((await json(res)).code).toBe("source_unavailable");
    expect(await publicDoc(h, "recipe-a-0001")).toBeUndefined();
  });

  it(`rate limits to ${MAX_PUBLISHES_PER_DAY} publishes per user per UTC day`, async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    await publish(h, alice, "recipe-a-0001");
    await h.db.doc(`users/${alice.uid}`).update({ "daily.publishes": { day: "2026-10-15", count: MAX_PUBLISHES_PER_DAY } });

    const res = await publish(h, alice, "recipe-a-0001");
    expect(res.status).toBe(429);
    expect(await json(res)).toMatchObject({ code: "rate_limited", retryAfterSeconds: 12 * 3600 });

    h.clock.set("2026-10-16T00:00:01Z");
    expect((await publish(h, alice, "recipe-a-0001")).status).toBe(200);
  });
});

describe.skipIf(!EMULATOR)("DELETE /recipes/:id/publish", () => {
  let h: Harness;
  let alice: TestUser;

  beforeEach(async () => {
    await resetEmulators();
    h = harness();
    alice = await signUp("alice@example.com", "Alice");
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    expect((await publish(h, alice, "recipe-a-0001")).status).toBe(200);
  });
  afterAll(closeAdmin);

  it("owner unpublishes: snapshot + source mapping gone, recipe private again; idempotent", async () => {
    const res = await call(h, alice, "DELETE", "/recipes/recipe-a-0001/publish");
    expect(res.status).toBe(204);
    expect(await publicDoc(h, "recipe-a-0001")).toBeUndefined();
    expect((await h.db.doc(`sources/youtube:${VID}`).get()).exists).toBe(false);
    expect((await h.db.doc("recipes/recipe-a-0001").get()).data()?.visibility).toBe("private");
    expect((await call(h, alice, "DELETE", "/recipes/recipe-a-0001/publish")).status).toBe(204);
  });

  it("someone else gets 404; an admin may unpublish", async () => {
    const bob = await signUp("bob@example.com");
    expect((await call(h, bob, "DELETE", "/recipes/recipe-a-0001/publish")).status).toBe(404);
    expect(await publicDoc(h, "recipe-a-0001")).toBeDefined();

    const admin = await signUpAdmin("admin@example.com");
    expect((await call(h, admin, "DELETE", "/recipes/recipe-a-0001/publish")).status).toBe(204);
    expect(await publicDoc(h, "recipe-a-0001")).toBeUndefined();
  });

  it("leaves a mapping that points to another recipe alone", async () => {
    await h.db.doc(`sources/youtube:${VID}`).set({ publicRecipeId: "someone-else-1" });
    await call(h, alice, "DELETE", "/recipes/recipe-a-0001/publish");
    expect((await h.db.doc(`sources/youtube:${VID}`).get()).data()).toEqual({ publicRecipeId: "someone-else-1" });
  });
});

describe.skipIf(!EMULATOR)("likes, saves, copy", () => {
  let h: Harness;
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    await resetEmulators();
    h = harness();
    alice = await signUp("alice@example.com", "Alice");
    bob = await signUp("bob@example.com", "Bob");
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    expect((await publish(h, alice, "recipe-a-0001")).status).toBe(200);
  });
  afterAll(closeAdmin);

  const engage = (user: TestUser, method: "POST" | "DELETE", kind: "like" | "save", id = "recipe-a-0001") =>
    call(h, user, method, `/public/${id}/${kind}`);

  it("like/save are idempotent and keep stats + score true", async () => {
    let body = EngagementResponse.parse(await json(await engage(bob, "POST", "like")));
    expect(body).toEqual({ stats: { likes: 1, saves: 0, score: 1 }, liked: true, saved: false });
    body = EngagementResponse.parse(await json(await engage(bob, "POST", "like")));
    expect(body.stats).toEqual({ likes: 1, saves: 0, score: 1 });

    body = EngagementResponse.parse(await json(await engage(bob, "POST", "save")));
    expect(body).toEqual({ stats: { likes: 1, saves: 1, score: 3 }, liked: true, saved: true });
    body = EngagementResponse.parse(await json(await engage(alice, "POST", "save")));
    expect(body).toEqual({ stats: { likes: 1, saves: 2, score: 5 }, liked: false, saved: true });

    expect((await h.db.doc(`users/${bob.uid}/likes/recipe-a-0001`).get()).data()).toEqual({ likedAt: T0 });
    expect((await h.db.doc(`users/${bob.uid}/saves/recipe-a-0001`).get()).data()).toEqual({ savedAt: T0 });

    body = EngagementResponse.parse(await json(await engage(bob, "DELETE", "like")));
    expect(body).toEqual({ stats: { likes: 0, saves: 2, score: 4 }, liked: false, saved: true });
    body = EngagementResponse.parse(await json(await engage(bob, "DELETE", "like")));
    expect(body.stats).toEqual({ likes: 0, saves: 2, score: 4 });
    expect((await h.db.doc(`users/${bob.uid}/likes/recipe-a-0001`).get()).exists).toBe(false);

    expect((await publicDoc(h, "recipe-a-0001"))?.stats).toEqual({ likes: 0, saves: 2, score: 4 });
    // Only real changes count toward the daily limit (3 for bob: like, save, unlike).
    expect((await h.db.doc(`users/${bob.uid}`).get()).data()?.daily?.engagements).toEqual({ day: "2026-10-15", count: 3 });
  });

  it("404 on a hidden, in-review, or missing recipe; DELETE still clears a dangling save", async () => {
    await engage(bob, "POST", "save");
    await h.db.doc("publicRecipes/recipe-a-0001").update({ status: "hidden" });
    expect((await engage(bob, "POST", "like")).status).toBe(404);
    await h.db.doc("publicRecipes/recipe-a-0001").update({ status: "review" });
    expect((await engage(bob, "POST", "like")).status).toBe(404);
    expect((await engage(bob, "POST", "like", "no-such-recipe")).status).toBe(404);

    const res = await engage(bob, "DELETE", "save");
    expect(res.status).toBe(200);
    expect(EngagementResponse.parse(await json(res))).toEqual({ stats: { likes: 0, saves: 0, score: 0 }, liked: false, saved: false });
    expect((await h.db.doc(`users/${bob.uid}/saves/recipe-a-0001`).get()).exists).toBe(false);
    expect((await publicDoc(h, "recipe-a-0001"))?.stats.saves).toBe(0);

    await call(h, alice, "DELETE", "/recipes/recipe-a-0001/publish");
    expect((await engage(bob, "DELETE", "save")).status).toBe(200);
  });

  it(`rate limits to ${MAX_ENGAGEMENTS_PER_DAY} changes per day`, async () => {
    await engage(bob, "POST", "like");
    await h.db.doc(`users/${bob.uid}`).update({ "daily.engagements": { day: "2026-10-15", count: MAX_ENGAGEMENTS_PER_DAY } });
    const res = await engage(bob, "POST", "save");
    expect(res.status).toBe(429);
    expect((await json(res)).code).toBe("rate_limited");
    // A no-op repeat isn't a change, so it still answers.
    expect((await engage(bob, "POST", "like")).status).toBe(200);
  });

  it("copy makes a private v1 'edited' recipe with attribution, no Claude, no quota", async () => {
    const res = await call(h, bob, "POST", "/public/recipe-a-0001/copy");
    expect(res.status).toBe(201);
    const { recipe } = CopyResponse.parse(await json(res));
    expect(recipe.id).not.toBe("recipe-a-0001");
    expect(recipe).toMatchObject({
      ownerId: bob.uid,
      visibility: "private",
      title: "Egg Fried Rice",
      currentVersion: 1,
      createdAt: T0,
      latest: recipeWith("Egg Fried Rice"),
    });
    const { id: newId, ...storedRecipe } = recipe;
    expect((await h.db.doc(`recipes/${newId}`).get()).data()).toEqual(storedRecipe);
    expect((await h.db.doc(`recipes/${recipe.id}/versions/1`).get()).data()).toEqual({
      meta: { version: 1, source: "edited", createdAt: T0, note: "Copied from @alice_cooks's recipe" },
      recipe: recipeWith("Egg Fried Rice"),
    });
    expect((await h.db.doc(`recipes/${recipe.id}/private/transcript`).get()).exists).toBe(false);
    expect(h.claude.extractCalls).toBe(0);
    expect((await h.db.doc(`users/${bob.uid}`).get()).data()?.usage.recipesCreated).toBe(0);
  });

  it("copy: 404 for a non-live recipe unless it's your own", async () => {
    await h.db.doc("publicRecipes/recipe-a-0001").update({ status: "review" });
    expect((await call(h, bob, "POST", "/public/recipe-a-0001/copy")).status).toBe(404);
    expect((await call(h, alice, "POST", "/public/recipe-a-0001/copy")).status).toBe(201);
    expect((await call(h, bob, "POST", "/public/nope-nope-1/copy")).status).toBe(404);
  });
});

describe.skipIf(!EMULATOR)("POST /public/:id/report", () => {
  let h: Harness;
  let alice: TestUser;

  beforeEach(async () => {
    await resetEmulators();
    h = harness();
    alice = await signUp("alice@example.com", "Alice");
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    expect((await publish(h, alice, "recipe-a-0001")).status).toBe(200);
  });
  afterAll(closeAdmin);

  const report = (user: TestUser | null, body: Record<string, unknown>, ip = "203.0.113.7", id = "recipe-a-0001") =>
    call(h, user, "POST", `/public/${id}/report`, body, { "X-Forwarded-For": `6.6.6.6, ${ip}` }); // forged first hop, real (Google-appended) last hop

  it("works signed out (App Check only) and logs only ids", async () => {
    const res = await report(null, { kind: "report", reason: "This is spam about crypto", contact: null });
    expect(res.status).toBe(202);
    const [r] = await reports(h);
    expect(r).toMatchObject({
      publicRecipeId: "recipe-a-0001",
      kind: "report",
      reason: "This is spam about crypto",
      contact: null,
      reporterUid: null,
      status: "open",
      createdAt: T0,
    });
    const events = h.logs.filter((l) => l.fields.event === "report_created");
    expect(events.map((e) => e.fields)).toEqual([{ event: "report_created", kind: "report", publicRecipeId: "recipe-a-0001" }]);
    const logText = JSON.stringify(h.logs);
    expect(logText).not.toContain("crypto");
    expect(logText).not.toContain("203.0.113.7");

    // The per-IP counter is keyed by a salted hash, never the raw IP.
    const system = await h.db.collection("system").get();
    const ipDocs = system.docs.filter((d) => d.id.startsWith("report-ip-"));
    expect(ipDocs).toHaveLength(1);
    expect(ipDocs[0]!.id).not.toContain("203");
    expect(JSON.stringify(ipDocs[0]!.data())).not.toContain("203.0.113.7");
  });

  it("attaches the reporter when signed in; claims need a contact", async () => {
    const bob = await signUp("bob@example.com");
    const noContact = await report(bob, { kind: "claim", reason: "This is my video", contact: null });
    expect(noContact.status).toBe(400);
    const ok = await report(bob, { kind: "claim", reason: "This is my video", contact: "owner@example.com" });
    expect(ok.status).toBe(202);
    const [r] = await reports(h);
    expect(r).toMatchObject({ kind: "claim", contact: "owner@example.com", reporterUid: bob.uid });
    expect(JSON.stringify(h.logs)).not.toContain("owner@example.com");
  });

  it("404 for a missing recipe; 400 for a bad body", async () => {
    expect((await report(null, { kind: "report", reason: "x", contact: null }, "203.0.113.7", "no-such-recipe")).status).toBe(404);
    expect((await report(null, { kind: "report", reason: "", contact: null })).status).toBe(400);
    expect((await report(null, { kind: "screening", reason: "x", contact: null })).status).toBe(400);
  });

  it(`rate limits to ${MAX_REPORTS_PER_DAY}/day per IP and per user`, async () => {
    for (let i = 0; i < MAX_REPORTS_PER_DAY; i++) {
      expect((await report(null, { kind: "report", reason: `r${i}`, contact: null })).status).toBe(202);
    }
    const limited = await report(null, { kind: "report", reason: "one more", contact: null });
    expect(limited.status).toBe(429);
    expect((await json(limited)).code).toBe("rate_limited");
    // Another IP is fine...
    const bob = await signUp("bob@example.com");
    for (let i = 0; i < MAX_REPORTS_PER_DAY; i++) {
      expect((await report(bob, { kind: "report", reason: `b${i}`, contact: null }, `198.51.100.${i + 1}`)).status).toBe(202);
    }
    // ...but the same user from yet another IP is over the per-user limit.
    expect((await report(bob, { kind: "report", reason: "again", contact: null }, "192.0.2.200")).status).toBe(429);
    // Next UTC day: allowed again.
    h.clock.set("2026-10-16T00:00:01Z");
    expect((await report(null, { kind: "report", reason: "tomorrow", contact: null })).status).toBe(202);
  });
});

describe.skipIf(!EMULATOR)("admin queue + actions", () => {
  let h: Harness;
  let alice: TestUser;
  let admin: TestUser;

  beforeEach(async () => {
    await resetEmulators();
    h = harness();
    alice = await signUp("alice@example.com", "Alice");
    admin = await signUpAdmin("admin@example.com");
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    await publish(h, alice, "recipe-a-0001");
  });
  afterAll(closeAdmin);

  async function fileReport(reason: string, at: string): Promise<string> {
    h.clock.set(at);
    const res = await call(h, null, "POST", "/public/recipe-a-0001/report", { kind: "report", reason, contact: null });
    expect(res.status).toBe(202);
    return (await reports(h)).find((r) => r.reason === reason)!.id;
  }

  it("403 forbidden for a signed-in non-admin; /me reports isAdmin", async () => {
    expect((await call(h, alice, "GET", "/admin/queue")).status).toBe(403);
    const res = await call(h, alice, "POST", "/admin/public/recipe-a-0001", { action: "hide", reportId: null, note: null });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe("forbidden");
    expect((await publicDoc(h, "recipe-a-0001"))?.status).toBe("live");
    expect((await json(await call(h, admin, "GET", "/me"))).isAdmin).toBe(true);
  });

  it("lists open reports newest first, joined with their public recipe", async () => {
    const older = await fileReport("older", "2026-10-15T13:00:00Z");
    const newer = await fileReport("newer", "2026-10-15T14:00:00Z");
    await h.db.collection("reports").add({
      publicRecipeId: "gone-recipe-1",
      kind: "report",
      reason: "orphan",
      contact: null,
      reporterUid: null,
      status: "open",
      createdAt: "2026-10-15T12:30:00.000Z",
      resolvedAt: null,
      resolution: null,
    });

    const res = await call(h, admin, "GET", "/admin/queue");
    expect(res.status).toBe(200);
    const { items } = AdminQueueResponse.parse(await json(res));
    expect(items.map((i) => i.report.id).slice(0, 2)).toEqual([newer, older]);
    expect(items[0]!.publicRecipe?.id).toBe("recipe-a-0001");
    expect(items[2]!.report.reason).toBe("orphan");
    expect(items[2]!.publicRecipe).toBeNull();
  });

  it("hide → hidden + report resolved; restore → live; dismiss resolves only", async () => {
    const r1 = await fileReport("first", "2026-10-15T13:00:00Z");
    const r2 = await fileReport("second", "2026-10-15T13:05:00Z");

    h.clock.set("2026-10-15T15:00:00Z");
    let res = await call(h, admin, "POST", "/admin/public/recipe-a-0001", { action: "hide", reportId: r1, note: "spam" });
    expect(res.status).toBe(204);
    expect((await publicDoc(h, "recipe-a-0001"))?.status).toBe("hidden");
    expect((await h.db.doc(`reports/${r1}`).get()).data()).toMatchObject({
      status: "resolved",
      resolution: "hidden",
      resolvedAt: "2026-10-15T15:00:00.000Z",
    });
    expect(h.logs.some((l) => l.fields.event === "admin_action" && l.fields.action === "hide")).toBe(true);

    res = await call(h, admin, "POST", "/admin/public/recipe-a-0001", { action: "restore", reportId: null, note: null });
    expect(res.status).toBe(204);
    expect((await publicDoc(h, "recipe-a-0001"))?.status).toBe("live");

    res = await call(h, admin, "POST", "/admin/public/recipe-a-0001", { action: "dismiss", reportId: r2, note: null });
    expect(res.status).toBe(204);
    expect((await h.db.doc(`reports/${r2}`).get()).data()).toMatchObject({ status: "resolved", resolution: "dismissed" });
    expect((await publicDoc(h, "recipe-a-0001"))?.status).toBe("live");

    const { items } = AdminQueueResponse.parse(await json(await call(h, admin, "GET", "/admin/queue")));
    expect(items).toEqual([]);
  });

  it("restores a screening-flagged publish into the bank", async () => {
    h.claude.onScreen = async () => ({ output: { decision: "review", reason: "unsure" }, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    await publish(h, alice, "recipe-a-0001");
    const [flag] = await reports(h);
    expect(flag?.kind).toBe("screening");
    const res = await call(h, admin, "POST", "/admin/public/recipe-a-0001", { action: "restore", reportId: flag!.id, note: null });
    expect(res.status).toBe(204);
    expect((await publicDoc(h, "recipe-a-0001"))?.status).toBe("live");
    expect((await h.db.doc(`reports/${flag!.id}`).get()).data()?.resolution).toBe("restored");
  });

  it("validates: dismiss needs a report; report must belong to the recipe; missing recipe 404", async () => {
    const r1 = await fileReport("first", "2026-10-15T13:00:00Z");
    expect((await call(h, admin, "POST", "/admin/public/recipe-a-0001", { action: "dismiss", reportId: null, note: null })).status).toBe(400);
    expect((await call(h, admin, "POST", "/admin/public/other-recipe-1", { action: "dismiss", reportId: r1, note: null })).status).toBe(404);
    expect((await call(h, admin, "POST", "/admin/public/other-recipe-1", { action: "hide", reportId: null, note: null })).status).toBe(404);
    expect((await call(h, admin, "POST", "/admin/public/recipe-a-0001", { action: "nuke", reportId: null, note: null })).status).toBe(400);
  });
});

describe.skipIf(!EMULATOR)("DELETE /me (Phase 2 cleanup)", () => {
  let h: Harness;
  let alice: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    await resetEmulators();
    alice = await signUp("alice@example.com", "Alice");
    bob = await signUp("bob@example.com", "Bob");
    // Real clock: DELETE /me compares the token's real auth_time against now().
    h = harness({}, new Date().toISOString());
  });
  afterAll(closeAdmin);

  it("unpublishes, frees the handle, removes likes/saves and gives back their counts", async () => {
    await seedRecipe(h, alice.uid, "recipe-a-0001");
    await seedRecipe(h, bob.uid, "recipe-b-0001", "Bob's Noodles");
    expect((await publish(h, alice, "recipe-a-0001")).status).toBe(200);
    expect((await publish(h, bob, "recipe-b-0001", { handle: "bob_eats", source: ytSource(VID2) })).status).toBe(200);

    // Alice likes + saves Bob's; Bob likes Alice's.
    await call(h, alice, "POST", "/public/recipe-b-0001/like");
    await call(h, alice, "POST", "/public/recipe-b-0001/save");
    await call(h, bob, "POST", "/public/recipe-b-0001/like");
    await call(h, bob, "POST", "/public/recipe-a-0001/like");
    expect((await publicDoc(h, "recipe-b-0001"))?.stats).toEqual({ likes: 2, saves: 1, score: 4 });

    // Alice also files a claim with her email on it.
    const claim = { kind: "claim", reason: "This is my video", contact: "alice@example.com" };
    expect((await call(h, alice, "POST", "/public/recipe-b-0001/report", claim)).status).toBe(202);

    expect((await call(h, alice, "DELETE", "/me")).status).toBe(204);

    // The claim stays in the queue but no longer identifies her (GDPR).
    const reports = await h.db.collection("reports").where("kind", "==", "claim").get();
    expect(reports.docs.map((d) => [d.get("reporterUid"), d.get("contact")])).toEqual([[null, null]]);

    for (const path of [
      "publicRecipes/recipe-a-0001",
      `sources/youtube:${VID}`,
      "handles/alice_cooks",
      `users/${alice.uid}`,
      `users/${alice.uid}/likes/recipe-b-0001`,
      `users/${alice.uid}/saves/recipe-b-0001`,
      "recipes/recipe-a-0001",
    ]) {
      expect((await h.db.doc(path).get()).exists, path).toBe(false);
    }
    expect((await publicDoc(h, "recipe-b-0001"))?.stats).toEqual({ likes: 1, saves: 0, score: 1 });
    // Bob's like of Alice's (now gone) recipe dangles; the web shows "no longer available".
    expect((await h.db.doc(`users/${bob.uid}/likes/recipe-a-0001`).get()).exists).toBe(true);
    expect((await h.db.doc(`sources/youtube:${VID2}`).get()).exists).toBe(true);
    expect((await h.db.doc("handles/bob_eats").get()).exists).toBe(true);
  });
});
