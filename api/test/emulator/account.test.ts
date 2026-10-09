import {
  ImportResponse,
  MAX_TRANSCRIPT_CHARS,
  MeResponse,
  type Recipe,
  type RecipeDoc,
  type VersionedRecipe,
} from "@recipe/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EXTRACTED, json, TRANSCRIPT } from "../fixtures";
import { call, closeAdmin, EMULATOR, harness, resetEmulators, signUp, type Harness, type TestUser } from "./harness";

const RECIPE: Recipe = { ...EXTRACTED, warnings: [] };

function backupJob(id: string, versions: VersionedRecipe[], transcript = TRANSCRIPT as typeof TRANSCRIPT | null) {
  return {
    job: {
      id,
      fileName: `${id}.mp3`,
      status: "done" as const,
      error: null,
      title: versions.at(-1)?.recipe.title ?? null,
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-02T10:00:00.000Z",
    },
    transcript,
    versions,
    audio: null,
  };
}

const v = (version: number, source: VersionedRecipe["meta"]["source"], title: string, note: string | null = null) => ({
  meta: { version, source, createdAt: `2026-05-0${version}T10:00:00.000Z`, note },
  recipe: { ...RECIPE, title },
});

describe.skipIf(!EMULATOR)("POST /import", () => {
  let h: Harness;
  let alice: TestUser;

  beforeEach(async () => {
    await resetEmulators();
    h = harness();
    alice = await signUp("alice@example.com");
  });
  afterAll(closeAdmin);

  it("imports jobs with every version preserved, without Claude or quota", async () => {
    const versions = [v(1, "extracted", "Rice"), v(2, "edited", "Better Rice"), v(3, "rollback", "Rice", "rolled back to v1")];
    const res = await call(h, alice, "POST", "/import", { jobs: [backupJob("local-job-0001", versions)] });
    expect(res.status).toBe(200);
    expect(ImportResponse.parse(await json(res))).toEqual({ imported: ["local-job-0001"], skipped: [] });

    const doc = (await h.db.doc("recipes/local-job-0001").get()).data() as RecipeDoc;
    expect(doc).toEqual({
      ownerId: alice.uid,
      visibility: "private",
      title: "Rice",
      fileName: "local-job-0001.mp3",
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-02T10:00:00.000Z",
      currentVersion: 3,
      latest: versions[2]!.recipe,
    });
    for (const ver of versions) {
      expect((await h.db.doc(`recipes/local-job-0001/versions/${ver.meta.version}`).get()).data()).toEqual(ver);
    }
    expect((await h.db.doc("recipes/local-job-0001/private/transcript").get()).data()?.transcript).toEqual(TRANSCRIPT);

    expect(h.claude.extractCalls).toBe(0);
    expect((await h.db.doc(`users/${alice.uid}`).get()).exists).toBe(false);
  });

  it("skips ids that already exist (any owner), jobs with no versions, and bad ids", async () => {
    const bob = await signUp("bob@example.com");
    await call(h, bob, "POST", "/import", { jobs: [backupJob("taken-job-0001", [v(1, "extracted", "Bob's")])] });

    const res = await call(h, alice, "POST", "/import", {
      jobs: [
        backupJob("taken-job-0001", [v(1, "extracted", "Alice's")]),
        backupJob("empty-job-0001", []),
        backupJob("bad/id", [v(1, "extracted", "x")]),
        backupJob("fresh-job-0001", [v(1, "extracted", "Fresh")], null),
        backupJob("fresh-job-0001", [v(1, "extracted", "Duplicate in request")]),
      ],
    });
    expect(await json(res)).toEqual({
      imported: ["fresh-job-0001"],
      skipped: ["taken-job-0001", "empty-job-0001", "bad/id", "fresh-job-0001"],
    });
    const taken = (await h.db.doc("recipes/taken-job-0001").get()).data() as RecipeDoc;
    expect(taken.ownerId).toBe(bob.uid);
    expect(taken.title).toBe("Bob's");
    expect((await h.db.doc("recipes/fresh-job-0001").get()).data()?.title).toBe("Fresh");
    // transcript null → no transcript doc
    expect((await h.db.doc("recipes/fresh-job-0001/private/transcript").get()).exists).toBe(false);
  });

  it("is idempotent: importing the same library twice skips everything the second time", async () => {
    const jobs = [backupJob("local-job-0001", [v(1, "extracted", "Rice")])];
    await call(h, alice, "POST", "/import", { jobs });
    const res = await call(h, alice, "POST", "/import", { jobs });
    expect(await json(res)).toEqual({ imported: [], skipped: ["local-job-0001"] });
  });

  it("imports the recipe but drops an oversized transcript", async () => {
    const huge = { language: "en", segments: [{ start: 0, end: 1, text: "a".repeat(MAX_TRANSCRIPT_CHARS + 1) }] };
    const res = await call(h, alice, "POST", "/import", { jobs: [backupJob("big-job-0001", [v(1, "extracted", "Big")], huge)] });
    expect((await json(res)).imported).toEqual(["big-job-0001"]);
    expect((await h.db.doc("recipes/big-job-0001/private/transcript").get()).exists).toBe(false);
  });

  it("rejects malformed bodies and jobs carrying audio", async () => {
    expect((await call(h, alice, "POST", "/import", { jobs: "nope" })).status).toBe(400);
    const withAudio = { ...backupJob("local-job-0001", [v(1, "extracted", "Rice")]), audio: { fileName: "a", mimeType: "audio/mp3", base64: "AA==" } };
    expect((await call(h, alice, "POST", "/import", { jobs: [withAudio] })).status).toBe(400);
    expect((await call(h, null, "POST", "/import", { jobs: [] })).status).toBe(401);
  });
});

describe.skipIf(!EMULATOR)("GET /me and DELETE /me", () => {
  let h: Harness;
  let alice: TestUser;

  beforeEach(async () => {
    await resetEmulators();
    alice = await signUp("alice@example.com", "Alice");
    // Real clock: DELETE /me compares the token's real auth_time against now().
    h = harness({ freeMonthlyRecipes: 30 }, new Date().toISOString());
  });
  afterAll(closeAdmin);

  it("GET /me creates the user doc on first call", async () => {
    const res = await call(h, alice, "GET", "/me");
    expect(res.status).toBe(200);
    const me = MeResponse.parse(await json(res));
    expect(me).toMatchObject({ uid: alice.uid, email: "alice@example.com", plan: "free" });
    expect(me.usage).toMatchObject({ used: 0, limit: 30, remaining: 30 });

    const doc = (await h.db.doc(`users/${alice.uid}`).get()).data();
    expect(doc).toMatchObject({ email: "alice@example.com", displayName: "Alice", photoURL: null, plan: "free" });

    // Second call reads, doesn't reset.
    await h.db.doc(`users/${alice.uid}`).update({ "usage.recipesCreated": 4 });
    expect((await json(await call(h, alice, "GET", "/me"))).usage.used).toBe(4);
  });

  it("DELETE /me removes recipes (with versions + transcript), the user doc, and the Auth user", async () => {
    const bob = await signUp("bob@example.com");
    for (const id of ["recipe-a-0001", "recipe-a-0002"]) {
      expect((await call(h, alice, "POST", "/recipes", { id, fileName: "a.mp3", transcript: TRANSCRIPT })).status).toBe(201);
    }
    await call(h, alice, "POST", "/recipes/recipe-a-0001/reextract", {});
    expect((await call(h, bob, "POST", "/recipes", { id: "recipe-b-0001", fileName: "b.mp3", transcript: TRANSCRIPT })).status).toBe(201);

    const res = await call(h, alice, "DELETE", "/me");
    expect(res.status).toBe(204);

    for (const path of [
      "recipes/recipe-a-0001",
      "recipes/recipe-a-0001/versions/1",
      "recipes/recipe-a-0001/versions/2",
      "recipes/recipe-a-0001/private/transcript",
      "recipes/recipe-a-0002",
      "recipes/recipe-a-0002/versions/1",
      `users/${alice.uid}`,
    ]) {
      expect((await h.db.doc(path).get()).exists, path).toBe(false);
    }
    await expect(h.auth.getUser(alice.uid)).rejects.toMatchObject({ code: "auth/user-not-found" });

    // Bob is untouched.
    expect((await h.db.doc("recipes/recipe-b-0001").get()).exists).toBe(true);
    expect((await h.db.doc("recipes/recipe-b-0001/versions/1").get()).exists).toBe(true);
    expect((await h.auth.getUser(bob.uid)).uid).toBe(bob.uid);

    // The deleted user's token no longer works.
    expect((await call(h, alice, "DELETE", "/me")).status).toBe(401);
  });

  it("DELETE /me refuses a sign-in older than 10 minutes", async () => {
    await call(h, alice, "GET", "/me");
    h.clock.set(new Date(Date.now() + 11 * 60 * 1000).toISOString());
    const res = await call(h, alice, "DELETE", "/me");
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.code).toBe("unauthenticated");
    expect(body.error).toMatch(/sign in again/i);
    expect((await h.db.doc(`users/${alice.uid}`).get()).exists).toBe(true);
    expect((await h.auth.getUser(alice.uid)).uid).toBe(alice.uid);
  });
});
