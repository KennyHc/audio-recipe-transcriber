// Cloud mode: everything the browser reads/writes in Firestore directly. What's allowed is
// exactly firebase/firestore.rules (tests: firebase/test/rules.test.ts):
//   - read own recipes (queries MUST filter ownerId == uid), versions, transcript;
//   - save an edit/rollback: versions/{n+1} + the recipe's currentVersion/latest/title/updatedAt
//     in ONE atomic write (here: a transaction, so n is read and written together);
//   - update (never create) the transcript doc;
//   - delete a recipe with its versions and transcript in one batch.
// Recipes, "extracted"/"reextracted" versions and transcripts are created only by the API.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import {
  COLLECTIONS,
  RecipeDoc,
  TRANSCRIPT_DOC_ID,
  TranscriptDoc,
  VersionedRecipe,
  type CloudRecipe,
  type Recipe,
  type Transcript,
} from "@recipe/shared";
import { buildClientVersionWrite } from "./mapping";
import { friendlyFirestoreMessage } from "./errors";

export interface RecipeStore {
  /** The user's recipes, updatedAt desc. Backed by a live query after the first call. */
  listRecipes(uid: string): Promise<CloudRecipe[]>;
  getRecipe(id: string): Promise<CloudRecipe>;
  /** Puts a recipe the API just returned into the live cache (before the snapshot catches up). */
  noteRecipe(uid: string, recipe: CloudRecipe): void;
  getVersion(id: string, version: number): Promise<VersionedRecipe>;
  /** Every version, oldest first. */
  listVersions(id: string): Promise<VersionedRecipe[]>;
  saveClientVersion(id: string, recipe: Recipe, source: "edited" | "rollback", note: string | null): Promise<VersionedRecipe>;
  /** null when the recipe has no transcript doc. */
  getTranscript(id: string): Promise<Transcript | null>;
  putTranscript(id: string, transcript: Transcript): Promise<void>;
  /** Deletes the recipe with its versions and transcript. false if it isn't in the account. */
  deleteRecipe(id: string): Promise<boolean>;
  /** Drops the live query and cache (sign-out / user change). */
  reset(): void;
}

/** Batched writes are capped at 500; stay well under it. */
const MAX_DELETES_PER_BATCH = 400;

function parseRecipe(id: string, data: unknown): CloudRecipe | null {
  const parsed = RecipeDoc.safeParse(data);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn(`Skipping recipe ${id}: unexpected shape`, parsed.error.issues);
    return null;
  }
  return { ...parsed.data, id };
}

function byUpdatedDesc(a: CloudRecipe, b: CloudRecipe): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function createRecipeStore(db: Firestore): RecipeStore {
  const recipeRef = (id: string) => doc(db, COLLECTIONS.recipes, id);
  const versionsRef = (id: string) => collection(db, COLLECTIONS.recipes, id, COLLECTIONS.versions);
  const transcriptRef = (id: string) => doc(db, COLLECTIONS.recipes, id, COLLECTIONS.private, TRANSCRIPT_DOC_ID);

  // One live query per signed-in user, started lazily by listRecipes. The library mounts on
  // every visit, so after the first load it renders straight from this cache.
  let live: {
    uid: string;
    recipes: Map<string, CloudRecipe>;
    ready: Promise<void>;
    unsubscribe: () => void;
  } | null = null;

  function startLive(uid: string) {
    let resolveReady!: () => void;
    let rejectReady!: (err: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const recipes = new Map<string, CloudRecipe>();
    const q = query(
      collection(db, COLLECTIONS.recipes),
      where("ownerId", "==", uid), // required by the rules
      orderBy("updatedAt", "desc"),
    );
    const state = {
      uid,
      recipes,
      ready,
      unsubscribe: () => undefined as void,
    };
    state.unsubscribe = onSnapshot(
      q,
      (snap) => {
        recipes.clear();
        for (const d of snap.docs) {
          const r = parseRecipe(d.id, d.data());
          if (r) recipes.set(r.id, r);
        }
        resolveReady();
      },
      (err) => {
        rejectReady(err);
        // The listener is dead after an error; start a fresh one on the next listRecipes.
        if (live === state) live = null;
      },
    );
    live = state;
    return state;
  }

  return {
    async listRecipes(uid) {
      const state = live && live.uid === uid ? live : (live?.unsubscribe(), startLive(uid));
      try {
        await state.ready;
      } catch (err) {
        throw new Error(friendlyFirestoreMessage(err));
      }
      return [...state.recipes.values()].sort(byUpdatedDesc);
    },

    async getRecipe(id) {
      const cached = live?.recipes.get(id);
      if (cached) return cached;
      let snap;
      try {
        snap = await getDoc(recipeRef(id));
      } catch (err) {
        throw new Error(friendlyFirestoreMessage(err));
      }
      if (!snap.exists()) throw new Error("Recipe not found.");
      const r = parseRecipe(id, snap.data());
      if (!r) throw new Error("This recipe couldn't be read.");
      return r;
    },

    noteRecipe(uid, recipe) {
      if (live && live.uid === uid) live.recipes.set(recipe.id, recipe);
    },

    async getVersion(id, version) {
      let snap;
      try {
        snap = await getDoc(doc(versionsRef(id), String(version)));
      } catch (err) {
        throw new Error(friendlyFirestoreMessage(err, "version"));
      }
      if (!snap.exists()) throw new Error(`Version ${version} not found.`);
      const parsed = VersionedRecipe.safeParse(snap.data());
      if (!parsed.success) throw new Error(`Version ${version} couldn't be read.`);
      return parsed.data;
    },

    async listVersions(id) {
      let snap;
      try {
        snap = await getDocs(versionsRef(id));
      } catch (err) {
        throw new Error(friendlyFirestoreMessage(err));
      }
      const out: VersionedRecipe[] = [];
      for (const d of snap.docs) {
        const parsed = VersionedRecipe.safeParse(d.data());
        if (parsed.success) out.push(parsed.data);
      }
      return out.sort((a, b) => a.meta.version - b.meta.version);
    },

    async saveClientVersion(id, recipe, source, note) {
      const ref = recipeRef(id);
      try {
        const versioned = await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new Error("Recipe not found.");
          const current = (snap.data() as { currentVersion?: unknown }).currentVersion;
          if (typeof current !== "number") throw new Error("This recipe couldn't be read.");
          const write = buildClientVersionWrite(current, recipe, source, note);
          tx.set(doc(versionsRef(id), write.versionId), write.versioned);
          tx.update(ref, write.recipeUpdate);
          return write;
        });
        const cached = live?.recipes.get(id);
        if (cached && live) {
          live.recipes.set(id, { ...cached, ...versioned.recipeUpdate });
        }
        return versioned.versioned;
      } catch (err) {
        if (err instanceof Error && !("code" in err)) throw err; // our own messages above
        throw new Error(friendlyFirestoreMessage(err));
      }
    },

    async getTranscript(id) {
      let snap;
      try {
        snap = await getDoc(transcriptRef(id));
      } catch (err) {
        throw new Error(friendlyFirestoreMessage(err, "transcript"));
      }
      if (!snap.exists()) return null;
      const parsed = TranscriptDoc.safeParse(snap.data());
      return parsed.success ? parsed.data.transcript : null;
    },

    async putTranscript(id, transcript) {
      // Rules allow update but not create: a recipe without a transcript doc (e.g. imported
      // without one) can't get one from the browser.
      try {
        await setDoc(transcriptRef(id), {
          transcript: { language: transcript.language, segments: transcript.segments },
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : null;
        if (code === "permission-denied") throw new Error("This recipe's transcript can't be edited.");
        throw new Error(friendlyFirestoreMessage(err, "transcript"));
      }
    },

    async deleteRecipe(id) {
      let versionRefs: DocumentReference[];
      try {
        versionRefs = (await getDocs(versionsRef(id))).docs.map((d) => d.ref);
      } catch (err) {
        const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : null;
        if (code === "permission-denied") return false; // not in this account
        throw new Error(friendlyFirestoreMessage(err));
      }
      // Children first, the recipe last: the rules need the recipe to exist while its children
      // are deleted (a single batch covers every recipe with < MAX_DELETES_PER_BATCH versions).
      const children: DocumentReference[] = [...versionRefs, transcriptRef(id)];
      try {
        for (let i = 0; i < children.length; i += MAX_DELETES_PER_BATCH) {
          const batch = writeBatch(db);
          const slice = children.slice(i, i + MAX_DELETES_PER_BATCH);
          for (const ref of slice) batch.delete(ref);
          if (i + MAX_DELETES_PER_BATCH >= children.length) batch.delete(recipeRef(id));
          await batch.commit();
        }
      } catch (err) {
        throw new Error(friendlyFirestoreMessage(err));
      }
      live?.recipes.delete(id);
      return true;
    },

    reset() {
      live?.unsubscribe();
      live = null;
    },
  };
}
