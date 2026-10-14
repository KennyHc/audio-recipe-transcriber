// Round 2 routes: link previews (GET /r/:id), client error reports, sourceUrl on create.
import { CreateRecipeResponse, type PublicRecipeDoc, type Recipe, RecipeDoc } from "@recipe/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetIndexCache } from "../../src/preview";
import { EXTRACTED, json, SITE_INDEX_HTML, TRANSCRIPT } from "../fixtures";
import { call, closeAdmin, EMULATOR, harness, type Harness, resetEmulators, signUp, type TestUser } from "./harness";

const T0 = "2026-10-15T12:00:00.000Z";

function publicDoc(status: "live" | "review", visibility: "public" | "unlisted" = "public"): PublicRecipeDoc {
  const recipe: Recipe = { ...EXTRACTED, title: 'Garlic <Noodles> & "Friends"', warnings: [] };
  return {
    ownerId: "someone",
    handle: "chef_kim",
    visibility,
    status,
    recipe,
    sourceVersion: 1,
    source: {
      kind: "video",
      platform: "youtube",
      videoId: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Noodles",
      channelName: "Chef Kim",
      channelUrl: null,
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      startOffsetSeconds: 0,
    },
    tags: [],
    terms: [],
    stats: { saves: 0, likes: 0, score: 0 },
    publishedAt: T0,
    updatedAt: T0,
    reviewReason: null,
  };
}

describe.skipIf(!EMULATOR)("GET /r/:id (link previews on Firebase Hosting)", () => {
  let h: Harness;
  beforeEach(async () => {
    await resetEmulators();
    resetIndexCache();
    h = harness();
  });
  afterAll(closeAdmin);

  it("injects escaped Open Graph tags for a live recipe", async () => {
    await h.db.doc("publicRecipes/recipe-live-01").set(publicDoc("live"));
    const res = await h.app.request("/r/recipe-live-01");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Garlic &lt;Noodles&gt; &amp; &quot;Friends&quot; · Recipe Transcriber</title>");
    expect(html).toContain('<meta property="og:image" content="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" />');
    expect(html).toContain('content="Recipe by Chef Kim · ');
    expect(html).toContain('<meta property="og:url" content="https://site.example/r/recipe-live-01" />');
    expect(html).not.toContain("<Noodles>");
    // The homepage's own preview tags are replaced, not duplicated (crawlers take the first).
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html).not.toContain("Homepage");
    expect(html).toContain('<meta charset="UTF-8" />');
  });

  it("serves the page unchanged for review, missing, or implausible ids", async () => {
    await h.db.doc("publicRecipes/recipe-rev-001").set(publicDoc("review"));
    for (const id of ["recipe-rev-001", "missing-recipe-1", "x"]) {
      const res = await h.app.request(`/r/${id}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(SITE_INDEX_HTML);
    }
  });

  it("marks unlisted recipes noindex", async () => {
    await h.db.doc("publicRecipes/recipe-unl-001").set(publicDoc("live", "unlisted"));
    expect(await (await h.app.request("/r/recipe-unl-001")).text()).toContain('name="robots" content="noindex"');
  });

  it("503 only when the site's index.html can't be fetched and nothing is cached", async () => {
    h.fetch.down = true;
    expect((await h.app.request("/r/recipe-live-01")).status).toBe(503);
  });
});

describe.skipIf(!EMULATOR)("POST /client-errors", () => {
  let h: Harness;
  let alice: TestUser;
  const report = {
    kind: "pipeline",
    stage: "transcribing",
    code: "QuotaExceededError",
    message: 'Failed for "my secret family recipe text" at https://x.example/r/abc-123 by me@example.com',
    mode: "cloud",
    appVersion: "abc1234",
    device: {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36",
      webgpu: true,
      deviceMemoryGb: 8,
      mobile: false,
    },
  };

  beforeEach(async () => {
    await resetEmulators();
    h = harness();
    alice = await signUp("alice@example.com", "Alice");
  });
  afterAll(closeAdmin);

  it("logs one sanitized line, signed out or in; stores nothing but a counter", async () => {
    expect((await call(h, null, "POST", "/client-errors", report, { "X-Forwarded-For": "203.0.113.9" })).status).toBe(204);
    expect((await call(h, alice, "POST", "/client-errors", report, { "X-Forwarded-For": "203.0.113.9" })).status).toBe(204);
    const lines = h.logs.filter((l) => l.fields.event === "client_error");
    expect(lines).toHaveLength(2);
    expect(lines[0]!.fields).toMatchObject({ kind: "pipeline", stage: "transcribing", browser: "Chrome 141 / macOS", signedIn: false });
    expect(lines[1]!.fields.signedIn).toBe(true);
    const logged = JSON.stringify(h.logs);
    for (const secret of ["secret family", "x.example", "me@example.com", "203.0.113.9", alice.uid, "Mozilla"]) {
      expect(logged).not.toContain(secret);
    }
    expect((await h.db.collection("reports").get()).size).toBe(0);
  });

  it("rejects bad bodies and rate limits per IP", async () => {
    expect((await call(h, null, "POST", "/client-errors", { ...report, kind: "nope" })).status).toBe(400);
    for (let i = 0; i < 50; i++) {
      await call(h, null, "POST", "/client-errors", report, { "X-Forwarded-For": "198.51.100.4" });
    }
    expect((await call(h, null, "POST", "/client-errors", report, { "X-Forwarded-For": "198.51.100.4" })).status).toBe(429);
    // Another IP is unaffected.
    expect((await call(h, null, "POST", "/client-errors", report, { "X-Forwarded-For": "198.51.100.5" })).status).toBe(204);
  });
});

describe.skipIf(!EMULATOR)("POST /recipes stores the upload's source link", () => {
  let h: Harness;
  let alice: TestUser;
  beforeEach(async () => {
    await resetEmulators();
    h = harness();
    alice = await signUp("alice@example.com", "Alice");
  });
  afterAll(closeAdmin);

  it("saves sourceUrl on the recipe doc (null when absent)", async () => {
    const withLink = await call(h, alice, "POST", "/recipes", {
      id: "recipe-link-01",
      fileName: "clip.mp3",
      transcript: TRANSCRIPT,
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(withLink.status).toBe(201);
    expect(CreateRecipeResponse.parse(await json(withLink)).recipe.sourceUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect((await h.db.doc("recipes/recipe-link-01").get()).data()?.sourceUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    await call(h, alice, "POST", "/recipes", { id: "recipe-nolink1", fileName: "clip.mp3", transcript: TRANSCRIPT });
    expect(RecipeDoc.parse((await h.db.doc("recipes/recipe-nolink1").get()).data()).sourceUrl).toBeNull();

    expect(
      (await call(h, alice, "POST", "/recipes", { id: "recipe-badlink", fileName: "c.mp3", transcript: TRANSCRIPT, sourceUrl: "javascript:x" })).status,
    ).toBe(400);
  });
});
