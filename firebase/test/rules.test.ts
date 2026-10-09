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
