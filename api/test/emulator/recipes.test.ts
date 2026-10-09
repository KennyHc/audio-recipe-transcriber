import {
  budgetDocId,
  CreateRecipeResponse,
  MAX_TRANSCRIPT_CHARS,
  type RecipeDoc,
  ReextractResponse,
  type Transcript,
} from "@recipe/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ClaudeOutputError } from "../../src/claude/types";
import { EXTRACTED, json, TRANSCRIPT, USAGE } from "../fixtures";
import { call, closeAdmin, EMULATOR, harness, resetEmulators, signUp, type Harness, type TestUser } from "./harness";

const COST_PER_CALL = (USAGE.inputTokens * 1 + USAGE.outputTokens * 5) / 1_000_000; // haiku prices

describe.skipIf(!EMULATOR)("POST /recipes", () => {
  let h: Harness;
  let alice: TestUser;

  beforeEach(async () => {
    await resetEmulators();
    h = harness({ freeMonthlyRecipes: 3 });
    alice = await signUp("alice@example.com", "Alice");
  });
  afterAll(closeAdmin);

  const create = (user: TestUser | null, id = "recipe-0001", transcript: Transcript = TRANSCRIPT) =>
    call(h, user, "POST", "/recipes", { id, fileName: "fried-rice.mp3", transcript });

  async function usageOf(uid: string) {
    return (await h.db.doc(`users/${uid}`).get()).data()?.usage;
  }
  async function budgetOf(day: string) {
    return (await h.db.doc(`system/${budgetDocId(day)}`).get()).data();
  }

  it("401s without a valid ID token", async () => {
    expect((await create(null)).status).toBe(401);
    const forged = { ...alice, idToken: "not-a-token" };
    const res = await create(forged);
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe("unauthenticated");
    expect(h.claude.extractCalls).toBe(0);
  });

  it("extracts, verifies, and writes recipe + v1 + transcript in one go, counting 1", async () => {
    const res = await create(alice);
    expect(res.status).toBe(201);
    const body = CreateRecipeResponse.parse(await json(res));

    expect(body.recipe).toMatchObject({
      id: "recipe-0001",
      ownerId: alice.uid,
      visibility: "private",
      title: "Egg Fried Rice",
      fileName: "fried-rice.mp3",
      currentVersion: 1,
      createdAt: "2026-10-15T12:00:00.000Z",
    });
    expect(body.version.meta).toEqual({ version: 1, source: "extracted", createdAt: "2026-10-15T12:00:00.000Z", note: null });
    // Verifier warning kept, and finalizeWarnings added one for the amount-less rice.
    expect(body.version.recipe.warnings.map((w) => w.target)).toEqual(["steps[0]", "ingredients[1]"]);
    expect(body.usage).toEqual({
      month: "2026-10",
      used: 1,
      limit: 3,
      remaining: 2,
      resetsAt: "2026-11-01T00:00:00.000Z",
    });

    const recipe = (await h.db.doc("recipes/recipe-0001").get()).data() as RecipeDoc;
    expect(recipe.latest).toEqual(body.version.recipe);
    const v1 = (await h.db.doc("recipes/recipe-0001/versions/1").get()).data();
    expect(v1).toEqual(body.version);
    const transcript = (await h.db.doc("recipes/recipe-0001/private/transcript").get()).data();
    expect(transcript).toEqual({ transcript: TRANSCRIPT, updatedAt: "2026-10-15T12:00:00.000Z" });

    // User doc created from the token's profile, usage counted.
    const user = (await h.db.doc(`users/${alice.uid}`).get()).data();
    expect(user).toMatchObject({ email: "alice@example.com", displayName: "Alice", plan: "free" });
    expect(user?.usage).toEqual({ month: "2026-10", recipesCreated: 1 });

    // Budget: both calls settled to their actual cost, nothing left reserved.
    const budget = await budgetOf("2026-10-15");
    expect(budget?.reservedUsd).toBeCloseTo(0, 12);
    expect(budget?.settledUsd).toBeCloseTo(2 * COST_PER_CALL, 12);
  });

  it("is idempotent on id: a re-POST returns the recipe without Claude or counting", async () => {
    await create(alice);
    const res = await create(alice);
    expect(res.status).toBe(200);
    const body = CreateRecipeResponse.parse(await json(res));
    expect(body.recipe.id).toBe("recipe-0001");
    expect(body.version.meta.version).toBe(1);
    expect(body.usage.used).toBe(1);
    expect(h.claude.extractCalls).toBe(1);
    expect(await usageOf(alice.uid)).toEqual({ month: "2026-10", recipesCreated: 1 });
  });

  it("409s when the id belongs to someone else, without revealing it", async () => {
    await create(alice);
    const bob = await signUp("bob@example.com");
    const res = await create(bob);
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.code).toBe("conflict");
    expect(JSON.stringify(body)).not.toContain("Egg Fried Rice");
    expect(h.claude.extractCalls).toBe(1);
  });

  it("refuses at the monthly limit with 429 and retry-after until next month", async () => {
    for (const id of ["recipe-0001", "recipe-0002", "recipe-0003"]) expect((await create(alice, id)).status).toBe(201);
    const res = await create(alice, "recipe-0004");
    expect(res.status).toBe(429);
    const body = await json(res);
    expect(body.code).toBe("quota_exceeded");
    // 2026-10-15T12:00Z → 2026-11-01T00:00Z
    expect(body.retryAfterSeconds).toBe((16 * 24 + 12) * 3600);
    expect(h.claude.extractCalls).toBe(3);
    expect((await h.db.doc("recipes/recipe-0004").get()).exists).toBe(false);
  });

  it("a full previous month doesn't count: rollover resets to 1", async () => {
    await h.db.doc(`users/${alice.uid}`).set({
      email: "alice@example.com",
      displayName: "Alice",
      photoURL: null,
      plan: "free",
      createdAt: "2026-09-01T00:00:00.000Z",
      usage: { month: "2026-09", recipesCreated: 3 },
    });
    const res = await create(alice);
    expect(res.status).toBe(201);
    expect(await usageOf(alice.uid)).toEqual({ month: "2026-10", recipesCreated: 1 });
  });

  it("refunds the quota and releases the budget when extraction fails", async () => {
    h.claude.onExtract = async () => {
      throw new Error("529 overloaded (sdk text that must not reach the client)");
    };
    const res = await create(alice);
    expect(res.status).toBe(502);
    const body = await json(res);
    expect(body.code).toBe("upstream_error");
    expect(body.error).not.toContain("overloaded");
    expect(await usageOf(alice.uid)).toEqual({ month: "2026-10", recipesCreated: 0 });
    expect((await h.db.doc("recipes/recipe-0001").get()).exists).toBe(false);
    expect(await budgetOf("2026-10-15")).toEqual({ reservedUsd: 0, settledUsd: 0 });
    expect(h.claude.verifyCalls).toBe(0);
  });

  it("settles billed usage (not release) when Claude answers unusably, and still refunds", async () => {
    h.claude.onExtract = async () => {
      throw new ClaudeOutputError(USAGE); // e.g. a refusal: tokens were billed
    };
    expect((await create(alice)).status).toBe(502);
    const budget = await budgetOf("2026-10-15");
    expect(budget?.reservedUsd).toBeCloseTo(0, 12);
    expect(budget?.settledUsd).toBeCloseTo(COST_PER_CALL, 12);
    expect((await usageOf(alice.uid)).recipesCreated).toBe(0);
  });

  it("downgrades a verification failure to a single 'other' warning", async () => {
    h.claude.onVerify = async () => {
      throw new Error("verifier exploded with internal details");
    };
    const res = await create(alice);
    expect(res.status).toBe(201);
    const body = CreateRecipeResponse.parse(await json(res));
    expect(body.version.recipe.warnings).toEqual([
      {
        kind: "other",
        message: expect.stringMatching(/^Verification could not run: /),
        target: null,
        suggestion: null,
      },
    ]);
    expect(body.version.recipe.warnings[0]!.message).not.toContain("internal details");
    expect(body.usage.used).toBe(1);
    const budget = await budgetOf("2026-10-15");
    expect(budget?.reservedUsd).toBeCloseTo(0, 12);
    expect(budget?.settledUsd).toBeCloseTo(COST_PER_CALL, 12); // extract only
  });

  it("503s budget_exhausted when the day's budget can't cover extraction, refunding the quota", async () => {
    h = harness({ dailyBudgetUsd: 0.01 });
    const res = await create(alice);
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(body.code).toBe("budget_exhausted");
    expect(body.retryAfterSeconds).toBe(12 * 3600); // until UTC midnight
    expect(h.claude.extractCalls).toBe(0);
    expect((await usageOf(alice.uid)).recipesCreated).toBe(0);
  });

  it("when the budget runs out between extract and verify, still saves with a warning", async () => {
    h.claude.onExtract = async () => {
      // Other users' spending lands while this extraction runs.
      await h.db.doc(`system/${budgetDocId("2026-10-15")}`).set({ reservedUsd: 0, settledUsd: 1.99 }, { merge: true });
      return { output: EXTRACTED, usage: USAGE };
    };
    const res = await create(alice);
    expect(res.status).toBe(201);
    const body = CreateRecipeResponse.parse(await json(res));
    expect(body.version.recipe.warnings).toHaveLength(1);
    expect(body.version.recipe.warnings[0]!.message).toMatch(/daily usage cap/);
    expect(h.claude.verifyCalls).toBe(0);
  });

  it("settles a reservation on the UTC day it was made, even after midnight", async () => {
    h.clock.set("2026-10-15T23:59:59Z");
    h.claude.onExtract = async () => {
      h.clock.set("2026-10-16T00:00:10Z"); // the call straddles midnight
      return { output: EXTRACTED, usage: USAGE };
    };
    expect((await create(alice)).status).toBe(201);

    const before = await budgetOf("2026-10-15");
    expect(before?.reservedUsd).toBeCloseTo(0, 12);
    expect(before?.settledUsd).toBeCloseTo(COST_PER_CALL, 12); // extract, reserved on the 15th
    const after = await budgetOf("2026-10-16");
    expect(after?.reservedUsd).toBeCloseTo(0, 12);
    expect(after?.settledUsd).toBeCloseTo(COST_PER_CALL, 12); // verify, reserved on the 16th
  });

  it("releases a reservation on the day it was made when a call fails after midnight", async () => {
    h.clock.set("2026-10-15T23:59:59Z");
    h.claude.onExtract = async () => {
      h.clock.set("2026-10-16T00:00:10Z");
      throw new Error("timeout");
    };
    expect((await create(alice)).status).toBe(502);
    expect(await budgetOf("2026-10-15")).toEqual({ reservedUsd: 0, settledUsd: 0 });
    // Nothing was reserved on the 16th, so nothing is touched there.
    expect(await budgetOf("2026-10-16")).toBeUndefined();
  });

  it("validates the body (400) and the transcript size (413)", async () => {
    const bad = await call(h, alice, "POST", "/recipes", { id: "x", fileName: "a", transcript: TRANSCRIPT });
    expect(bad.status).toBe(400);
    expect((await json(bad)).code).toBe("bad_request");

    const huge: Transcript = { language: "en", segments: [{ start: 0, end: 1, text: "a".repeat(MAX_TRANSCRIPT_CHARS + 1) }] };
    const big = await create(alice, "recipe-0001", huge);
    expect(big.status).toBe(413);
    expect((await json(big)).code).toBe("too_large");
    expect(h.claude.extractCalls).toBe(0);
    expect(await usageOf(alice.uid)).toBeUndefined();
  });

  it("413s a body over 1 MB", async () => {
    const res = await h.app.request("/recipes", {
      method: "POST",
      headers: { Authorization: `Bearer ${alice.idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(1024 * 1024 + 1) }),
    });
    expect(res.status).toBe(413);
  });
});

describe.skipIf(!EMULATOR)("POST /recipes/:id/reextract", () => {
  let h: Harness;
  let alice: TestUser;

  beforeEach(async () => {
    await resetEmulators();
    h = harness({ freeMonthlyRecipes: 3 });
    alice = await signUp("alice@example.com");
    expect(
      (await call(h, alice, "POST", "/recipes", { id: "recipe-0001", fileName: "a.mp3", transcript: TRANSCRIPT })).status,
    ).toBe(201);
  });
  afterAll(closeAdmin);

  const reextract = (user: TestUser, id = "recipe-0001") => call(h, user, "POST", `/recipes/${id}/reextract`, {});

  it("saves a new 'reextracted' version from the saved transcript and counts it", async () => {
    // The client edits the transcript first (allowed by the rules), then re-extracts.
    const edited: Transcript = { ...TRANSCRIPT, segments: [...TRANSCRIPT.segments, { start: 14, end: 16, text: "Serve hot." }] };
    await h.db.doc("recipes/recipe-0001/private/transcript").set({ transcript: edited, updatedAt: "2026-10-15T12:30:00.000Z" });
    h.clock.set("2026-10-15T13:00:00Z");

    const res = await reextract(alice);
    expect(res.status).toBe(200);
    const body = ReextractResponse.parse(await json(res));
    expect(h.claude.extractedFrom.at(-1)).toEqual(edited);
    expect(body.version.meta).toEqual({ version: 2, source: "reextracted", createdAt: "2026-10-15T13:00:00.000Z", note: null });
    expect(body.recipe).toMatchObject({ id: "recipe-0001", currentVersion: 2, updatedAt: "2026-10-15T13:00:00.000Z" });
    expect(body.recipe.createdAt).toBe("2026-10-15T12:00:00.000Z");
    expect(body.usage.used).toBe(2);

    const doc = (await h.db.doc("recipes/recipe-0001").get()).data() as RecipeDoc;
    expect(doc.currentVersion).toBe(2);
    expect(doc.latest).toEqual(body.version.recipe);
    expect((await h.db.doc("recipes/recipe-0001/versions/1").get()).data()?.meta.source).toBe("extracted");
    expect((await h.db.doc("recipes/recipe-0001/versions/2").get()).data()).toEqual(body.version);
  });

  it("404s for someone else's recipe and for a missing one (no Claude, no count)", async () => {
    const bob = await signUp("bob@example.com");
    const res = await reextract(bob);
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe("not_found");
    expect((await reextract(alice, "recipe-9999")).status).toBe(404);
    expect((await reextract(alice, "bad id!")).status).toBe(404);
    expect(h.claude.extractCalls).toBe(1);
    expect((await h.db.doc(`users/${bob.uid}`).get()).data()?.usage?.recipesCreated ?? 0).toBe(0);
  });

  it("409s when there's no saved transcript", async () => {
    await h.db.doc("recipes/recipe-0001/private/transcript").delete();
    const res = await reextract(alice);
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe("conflict");
    expect(h.claude.extractCalls).toBe(1);
  });

  it("refunds on extraction failure and leaves the recipe untouched", async () => {
    h.claude.onExtract = async () => {
      throw new Error("boom");
    };
    expect((await reextract(alice)).status).toBe(502);
    expect((await h.db.doc(`users/${alice.uid}`).get()).data()?.usage.recipesCreated).toBe(1);
    expect(((await h.db.doc("recipes/recipe-0001").get()).data() as RecipeDoc).currentVersion).toBe(1);
  });

  it("counts against the same monthly quota", async () => {
    expect((await reextract(alice)).status).toBe(200);
    expect((await reextract(alice)).status).toBe(200);
    const res = await reextract(alice);
    expect(res.status).toBe(429);
    expect((await json(res)).code).toBe("quota_exceeded");
  });
});
