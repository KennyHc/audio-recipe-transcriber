// Security-rule tests against the Firestore emulator (`npm test -w firebase-config`, which
// wraps vitest in `firebase emulators:exec`). Contract: shared/cloud.ts.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import type { Recipe, RecipeDoc, UserDoc, VersionedRecipe } from "@recipe/shared";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const RULES = readFileSync(fileURLToPath(new URL("../firestore.rules", import.meta.url)), "utf8");
const NOW = "2026-10-08T12:00:00.000Z";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-recipe",
    firestore: { rules: RULES },
  });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

function recipe(title: string): Recipe {
  return {
    title,
    description: null,
    servings: 2,
    totalTimeMinutes: null,
    ingredients: [
      {
        quantity: 2,
        unit: "clove",
        item: "garlic",
        prep: "minced",
        sourceText: "two cloves of garlic",
        timestamp: 3,
        confidence: "stated",
      },
    ],
    steps: [{ text: "Fry the garlic.", timestamp: 5, durationMinutes: 1, temperature: null }],
    tips: [],
    warnings: [],
  };
}

function version(n: number, source: string, r: Recipe): VersionedRecipe {
  return { meta: { version: n, source: source as VersionedRecipe["meta"]["source"], createdAt: NOW, note: null }, recipe: r };
}

function recipeDoc(ownerId: string, r: Recipe, currentVersion = 1): RecipeDoc {
  return {
    ownerId,
    visibility: "private",
    title: r.title,
    fileName: "clip.mp3",
    createdAt: NOW,
    updatedAt: NOW,
    currentVersion,
    latest: r,
  };
}

const userDoc: UserDoc = {
  email: "alice@example.com",
  displayName: "Alice",
  photoURL: null,
  plan: "free",
  createdAt: NOW,
  usage: { month: "2026-10", recipesCreated: 1 },
};

/** alice owns r1 (v1 extracted + transcript); bob owns r2. Written as the API would (no rules). */
async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/alice"), userDoc);
    await setDoc(doc(db, "users/bob"), { ...userDoc, email: "bob@example.com" });
    await setDoc(doc(db, "recipes/r1"), recipeDoc("alice", recipe("Garlic noodles")));
    await setDoc(doc(db, "recipes/r1/versions/1"), version(1, "extracted", recipe("Garlic noodles")));
    await setDoc(doc(db, "recipes/r1/private/transcript"), {
      transcript: { language: "en", segments: [{ start: 0, end: 4, text: "two cloves of garlic" }] },
      updatedAt: NOW,
    });
    await setDoc(doc(db, "recipes/r2"), recipeDoc("bob", recipe("Bob's soup")));
    await setDoc(doc(db, "recipes/r2/versions/1"), version(1, "extracted", recipe("Bob's soup")));
    await setDoc(doc(db, "recipes/r2/private/transcript"), {
      transcript: { language: "en", segments: [] },
      updatedAt: NOW,
    });
    await setDoc(doc(db, "system/budget-2026-10-08"), { reservedUsd: 0, settledUsd: 0.5 });
  });
}

const as = (uid: string): Firestore => env.authenticatedContext(uid).firestore();
const anon = (): Firestore => env.unauthenticatedContext().firestore();

/** The batch the web client uses to save an edit/rollback as version `n`. */
function saveVersionBatch(db: Firestore, recipeId: string, n: number, source: string, r: Recipe) {
  const batch = writeBatch(db);
  batch.set(doc(db, `recipes/${recipeId}/versions/${n}`), version(n, source, r));
  batch.update(doc(db, `recipes/${recipeId}`), {
    currentVersion: n,
    latest: r,
    title: r.title,
    updatedAt: NOW,
  });
  return batch;
}

describe("reading", () => {
  it("owner reads their own user doc, recipe, versions, transcript", async () => {
    const db = as("alice");
    await assertSucceeds(getDoc(doc(db, "users/alice")));
    await assertSucceeds(getDoc(doc(db, "recipes/r1")));
    await assertSucceeds(getDocs(collection(db, "recipes/r1/versions")));
    await assertSucceeds(getDoc(doc(db, "recipes/r1/private/transcript")));
  });

  it("owner lists their library with the ownerId filter", async () => {
    const db = as("alice");
    await assertSucceeds(
      getDocs(query(collection(db, "recipes"), where("ownerId", "==", "alice"), orderBy("updatedAt", "desc"))),
    );
  });

  it("an unfiltered or someone-else query is denied", async () => {
    await assertFails(getDocs(collection(as("alice"), "recipes")));
    await assertFails(getDocs(query(collection(as("alice"), "recipes"), where("ownerId", "==", "bob"))));
  });

  it("another user can't read anything of alice's", async () => {
    const db = as("bob");
    await assertFails(getDoc(doc(db, "users/alice")));
    await assertFails(getDoc(doc(db, "recipes/r1")));
    await assertFails(getDocs(collection(db, "recipes/r1/versions")));
    await assertFails(getDoc(doc(db, "recipes/r1/versions/1")));
    await assertFails(getDoc(doc(db, "recipes/r1/private/transcript")));
  });

  it("signed-out visitors can't read anything", async () => {
    const db = anon();
    await assertFails(getDoc(doc(db, "users/alice")));
    await assertFails(getDoc(doc(db, "recipes/r1")));
    await assertFails(getDoc(doc(db, "recipes/r1/versions/1")));
  });

  it("nobody reads system docs", async () => {
    await assertFails(getDoc(doc(as("alice"), "system/budget-2026-10-08")));
  });
});

describe("quota and ownership can't be faked", () => {
  it("users can't write their own user doc (usage, plan)", async () => {
    const db = as("alice");
    await assertFails(updateDoc(doc(db, "users/alice"), { "usage.recipesCreated": 0 }));
    await assertFails(setDoc(doc(db, "users/alice"), { ...userDoc, usage: { month: "2026-10", recipesCreated: 0 } }));
    await assertFails(setDoc(doc(as("carol"), "users/carol"), userDoc));
  });

  it("users can't create recipes directly", async () => {
    await assertFails(setDoc(doc(as("alice"), "recipes/new1"), recipeDoc("alice", recipe("Free recipe"))));
  });

  it("users can't write extracted or reextracted versions", async () => {
    for (const source of ["extracted", "reextracted"]) {
      await assertFails(saveVersionBatch(as("alice"), "r1", 2, source, recipe("Sneaky")).commit());
    }
  });

  it("users can't change ownerId or visibility", async () => {
    const db = as("alice");
    await assertFails(updateDoc(doc(db, "recipes/r1"), { ownerId: "bob" }));
    await assertFails(updateDoc(doc(db, "recipes/r1"), { visibility: "public" }));
  });

  it("users can't write system docs", async () => {
    await assertFails(setDoc(doc(as("alice"), "system/budget-2026-10-08"), { reservedUsd: 0, settledUsd: 0 }));
  });
});

describe("saving edits and rollbacks", () => {
  it("owner saves an edit as the next version in one batch", async () => {
    await assertSucceeds(saveVersionBatch(as("alice"), "r1", 2, "edited", recipe("Better noodles")).commit());
  });

  it("owner saves a rollback", async () => {
    const batch = saveVersionBatch(as("alice"), "r1", 2, "rollback", recipe("Garlic noodles"));
    await assertSucceeds(batch.commit());
  });

  it("the version must be exactly currentVersion + 1", async () => {
    await assertFails(saveVersionBatch(as("alice"), "r1", 3, "edited", recipe("Skip")).commit());
    await assertFails(saveVersionBatch(as("alice"), "r1", 1, "edited", recipe("Overwrite")).commit());
  });

  it("the version and the recipe update must land together and match", async () => {
    const db = as("alice");
    // Version alone.
    await assertFails(setDoc(doc(db, "recipes/r1/versions/2"), version(2, "edited", recipe("Alone"))));
    // Recipe update alone.
    await assertFails(
      updateDoc(doc(db, "recipes/r1"), { currentVersion: 2, latest: recipe("Alone"), title: "Alone", updatedAt: NOW }),
    );
    // Mismatched content.
    const batch = writeBatch(db);
    batch.set(doc(db, "recipes/r1/versions/2"), version(2, "edited", recipe("A")));
    batch.update(doc(db, "recipes/r1"), { currentVersion: 2, latest: recipe("B"), title: "B", updatedAt: NOW });
    await assertFails(batch.commit());
  });

  it("title must match the latest recipe's title", async () => {
    const db = as("alice");
    const batch = writeBatch(db);
    batch.set(doc(db, "recipes/r1/versions/2"), version(2, "edited", recipe("Real")));
    batch.update(doc(db, "recipes/r1"), { currentVersion: 2, latest: recipe("Real"), title: "Fake", updatedAt: NOW });
    await assertFails(batch.commit());
  });

  it("versions are immutable", async () => {
    await assertFails(
      setDoc(doc(as("alice"), "recipes/r1/versions/1"), version(1, "edited", recipe("Rewrite history"))),
    );
  });

  it("another user can't save versions on alice's recipe", async () => {
    await assertFails(saveVersionBatch(as("bob"), "r1", 2, "edited", recipe("Vandal")).commit());
  });
});

describe("transcripts", () => {
  const corrected = {
    transcript: { language: "en", segments: [{ start: 0, end: 4, text: "four cloves of garlic" }] },
    updatedAt: NOW,
  };

  it("owner updates their transcript", async () => {
    await assertSucceeds(setDoc(doc(as("alice"), "recipes/r1/private/transcript"), corrected));
  });

  it("another user can't", async () => {
    await assertFails(setDoc(doc(as("bob"), "recipes/r1/private/transcript"), corrected));
  });

  it("only the transcript doc, only the expected shape, never a create", async () => {
    const db = as("alice");
    await assertFails(setDoc(doc(db, "recipes/r1/private/other"), corrected));
    await assertFails(setDoc(doc(db, "recipes/r1/private/transcript"), { ...corrected, extra: true }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), "recipes/r1/private/transcript"));
    });
    await assertFails(setDoc(doc(db, "recipes/r1/private/transcript"), corrected));
  });
});

describe("deleting", () => {
  it("owner deletes a recipe with its versions and transcript in one batch", async () => {
    const db = as("alice");
    const batch = writeBatch(db);
    batch.delete(doc(db, "recipes/r1/versions/1"));
    batch.delete(doc(db, "recipes/r1/private/transcript"));
    batch.delete(doc(db, "recipes/r1"));
    await assertSucceeds(batch.commit());
  });

  it("another user can't delete", async () => {
    const db = as("bob");
    await assertFails(deleteDoc(doc(db, "recipes/r1")));
    await assertFails(deleteDoc(doc(db, "recipes/r1/versions/1")));
    await assertFails(deleteDoc(doc(db, "recipes/r1/private/transcript")));
  });
});

// ---------------------------------------------------------------------------------------
// Phase 2: the public recipe bank
// ---------------------------------------------------------------------------------------

function publicDoc(ownerId: string, status: string, visibility = "public") {
  return {
    ownerId,
    handle: ownerId,
    visibility,
    status,
    recipe: recipe("Public noodles"),
    sourceVersion: 1,
    source: {
      kind: "video",
      platform: "youtube",
      videoId: "abc123",
      url: "https://www.youtube.com/watch?v=abc123",
      title: "Noodles",
      channelName: "Chef",
      channelUrl: null,
      thumbnailUrl: null,
      startOffsetSeconds: 0,
    },
    tags: ["chinese"],
    terms: ["noodles", "garlic", "chinese"],
    stats: { saves: 0, likes: 0, score: 0 },
    publishedAt: NOW,
    updatedAt: NOW,
  };
}

/** p1 = alice's live public recipe (her r1); p2 = bob's, flagged for review; p3 unlisted. */
async function seedPublic() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "publicRecipes/r1"), publicDoc("alice", "live"));
    await setDoc(doc(db, "publicRecipes/r2"), publicDoc("bob", "review"));
    await setDoc(doc(db, "publicRecipes/p3"), publicDoc("bob", "live", "unlisted"));
    await setDoc(doc(db, "handles/alice"), { uid: "alice" });
    await setDoc(doc(db, "sources/youtube:abc123"), { publicRecipeId: "r1" });
    await setDoc(doc(db, "users/alice/saves/p3"), { savedAt: NOW });
    await setDoc(doc(db, "users/alice/likes/p3"), { likedAt: NOW });
    await setDoc(doc(db, "reports/x1"), { publicRecipeId: "r2", kind: "screening" });
  });
}

const admin = (): Firestore => env.authenticatedContext("root", { admin: true }).firestore();
const explore = (db: Firestore) =>
  query(
    collection(db, "publicRecipes"),
    where("status", "==", "live"),
    where("visibility", "==", "public"),
    orderBy("publishedAt", "desc"),
  );

describe("public recipes: reading", () => {
  beforeEach(seedPublic);

  it("anyone, signed out too, reads a live recipe by id — public or unlisted", async () => {
    await assertSucceeds(getDoc(doc(anon(), "publicRecipes/r1")));
    await assertSucceeds(getDoc(doc(anon(), "publicRecipes/p3")));
    await assertSucceeds(getDoc(doc(as("carol"), "publicRecipes/r1")));
  });

  it("Explore lists live public recipes with the required filters, signed out too", async () => {
    await assertSucceeds(getDocs(explore(anon())));
    await assertSucceeds(
      getDocs(query(explore(anon()), where("terms", "array-contains", "garlic"))),
    );
  });

  it("an unfiltered list, or one that could include unlisted/review, is denied", async () => {
    await assertFails(getDocs(collection(anon(), "publicRecipes")));
    await assertFails(getDocs(query(collection(anon(), "publicRecipes"), where("status", "==", "live"))));
  });

  it("recipes in review are visible only to the owner and admins", async () => {
    await assertFails(getDoc(doc(anon(), "publicRecipes/r2")));
    await assertFails(getDoc(doc(as("alice"), "publicRecipes/r2")));
    await assertSucceeds(getDoc(doc(as("bob"), "publicRecipes/r2")));
    await assertSucceeds(getDoc(doc(admin(), "publicRecipes/r2")));
  });

  it("owners list their own published recipes, any status", async () => {
    await assertSucceeds(getDocs(query(collection(as("bob"), "publicRecipes"), where("ownerId", "==", "bob"))));
    await assertFails(getDocs(query(collection(as("alice"), "publicRecipes"), where("ownerId", "==", "bob"))));
  });

  it("handles and video sources are readable by anyone", async () => {
    await assertSucceeds(getDoc(doc(anon(), "handles/alice")));
    await assertSucceeds(getDoc(doc(anon(), "sources/youtube:abc123")));
  });

  it("users read only their own likes and saves", async () => {
    await assertSucceeds(getDocs(collection(as("alice"), "users/alice/saves")));
    await assertSucceeds(getDoc(doc(as("alice"), "users/alice/likes/p3")));
    await assertFails(getDocs(collection(as("bob"), "users/alice/saves")));
    await assertFails(getDoc(doc(anon(), "users/alice/likes/p3")));
  });

  it("nobody reads reports from the browser, not even admins", async () => {
    await assertFails(getDoc(doc(as("bob"), "reports/x1")));
    await assertFails(getDoc(doc(admin(), "reports/x1")));
  });
});

describe("public recipes: only the API writes", () => {
  beforeEach(seedPublic);

  it("owners can't publish, change status, or inflate stats themselves", async () => {
    const db = as("alice");
    await assertFails(setDoc(doc(db, "publicRecipes/new1"), publicDoc("alice", "live")));
    await assertFails(updateDoc(doc(db, "publicRecipes/r1"), { "stats.likes": 999 }));
    await assertFails(updateDoc(doc(as("bob"), "publicRecipes/r2"), { status: "live" }));
    await assertFails(deleteDoc(doc(db, "publicRecipes/r1")));
  });

  it("nobody claims handles, sources, likes, saves, or files reports directly", async () => {
    await assertFails(setDoc(doc(as("carol"), "handles/carol"), { uid: "carol" }));
    await assertFails(setDoc(doc(as("carol"), "sources/youtube:zzz"), { publicRecipeId: "x" }));
    await assertFails(setDoc(doc(as("alice"), "users/alice/likes/r1"), { likedAt: NOW }));
    await assertFails(setDoc(doc(as("alice"), "users/alice/saves/r1"), { savedAt: NOW }));
    await assertFails(setDoc(doc(anon(), "reports/new"), { publicRecipeId: "r1" }));
  });

  it("admins can't bypass the API either", async () => {
    await assertFails(updateDoc(doc(admin(), "publicRecipes/r2"), { status: "live" }));
  });

  it("a published private recipe can't be deleted until it's unpublished", async () => {
    const db = as("alice");
    const deleteAll = () => {
      const batch = writeBatch(db);
      batch.delete(doc(db, "recipes/r1/versions/1"));
      batch.delete(doc(db, "recipes/r1/private/transcript"));
      batch.delete(doc(db, "recipes/r1"));
      return batch.commit();
    };
    await assertFails(deleteAll());

    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), "publicRecipes/r1"));
    });
    await assertSucceeds(deleteAll());
  });
});
