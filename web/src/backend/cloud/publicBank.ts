// Cloud mode: the public recipe bank (backend/publicBank.ts) on Firestore + the API.
// Reads follow firebase/firestore.rules exactly:
//   - publicRecipes/{id} by id: anyone when live; the owner and admins always. A missing doc
//     (or one you may not read) is "permission-denied", not "not found" — both mean unavailable.
//   - Explore queries filter status == "live" && visibility == "public" (lib/explore.ts).
//   - The owner's list filters ownerId == uid.
//   - users/{uid}/likes|saves are readable by that user only.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentSnapshot,
  type Firestore,
  type QueryConstraint,
} from "firebase/firestore";
import { COLLECTIONS, PUBLIC_COLLECTIONS, PublicRecipeDoc, type PublicRecipe } from "@recipe/shared";
import type { PublicBank, SavedEntry } from "../publicBank";
import { buildExploreQuery, matchesClientFilter } from "@/lib/explore";
import type { ApiClient } from "./api";
import { friendlyFirestoreMessage } from "./errors";

export function parsePublicRecipe(id: string, data: unknown): PublicRecipe | null {
  const parsed = PublicRecipeDoc.safeParse(data);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn(`Skipping public recipe ${id}: unexpected shape`, parsed.error.issues);
    return null;
  }
  return { ...parsed.data, id };
}

function errorCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
}

export interface PublicBankDeps {
  firestore: Firestore;
  api: ApiClient;
  /** null when signed out (waits for session restore). */
  currentUid(): Promise<string | null>;
}

export function createPublicBank({ firestore: db, api, currentUid }: PublicBankDeps): PublicBank {
  const publicRef = (id: string) => doc(db, PUBLIC_COLLECTIONS.publicRecipes, id);

  async function getPublicRecipe(id: string): Promise<PublicRecipe | null> {
    let snap;
    try {
      snap = await getDoc(publicRef(id));
    } catch (err) {
      const code = errorCode(err);
      if (code === "permission-denied" || code === "not-found") return null;
      throw new Error(friendlyFirestoreMessage(err));
    }
    if (!snap.exists()) return null;
    return parsePublicRecipe(id, snap.data());
  }

  async function requireUid(): Promise<string> {
    const uid = await currentUid();
    if (!uid) throw new Error("Sign in to continue.");
    return uid;
  }

  return {
    getPublicRecipe,

    async explore(params, cursor) {
      const spec = buildExploreQuery(params);
      const constraints: QueryConstraint[] = spec.filters.map((f) => where(f.field, f.op, f.value));
      constraints.push(orderBy(spec.orderBy.field, spec.orderBy.direction));
      if (cursor) constraints.push(startAfter(cursor as DocumentSnapshot));
      constraints.push(limit(spec.limit));
      let snap;
      try {
        snap = await getDocs(query(collection(db, PUBLIC_COLLECTIONS.publicRecipes), ...constraints));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Explore query failed", err);
        throw new Error(
          errorCode(err) === "unavailable" ? "You're offline — reconnect to browse recipes." : "Couldn't load recipes. Please try again.",
        );
      }
      const items: PublicRecipe[] = [];
      for (const d of snap.docs) {
        const r = parsePublicRecipe(d.id, d.data());
        if (r && matchesClientFilter(r, spec)) items.push(r);
      }
      const last = snap.docs[snap.docs.length - 1];
      return {
        items,
        cursor: snap.docs.length === spec.limit && last ? last : null,
        sortedByNewestForSearch: spec.sortedByNewestForSearch,
      };
    },

    async listOwnPublished() {
      const uid = await currentUid();
      const out = new Map<string, PublicRecipe>();
      if (!uid) return out;
      const snap = await getDocs(
        query(collection(db, PUBLIC_COLLECTIONS.publicRecipes), where("ownerId", "==", uid)), // required by the rules
      );
      for (const d of snap.docs) {
        const r = parsePublicRecipe(d.id, d.data());
        if (r) out.set(d.id, r);
      }
      return out;
    },

    async listSaved() {
      const uid = await requireUid();
      let snap;
      try {
        snap = await getDocs(collection(db, COLLECTIONS.users, uid, PUBLIC_COLLECTIONS.saves));
      } catch (err) {
        throw new Error(friendlyFirestoreMessage(err));
      }
      const entries = snap.docs.map((d) => {
        const savedAt = (d.data() as { savedAt?: unknown }).savedAt;
        return { id: d.id, savedAt: typeof savedAt === "string" ? savedAt : null };
      });
      entries.sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""));
      const recipes = await Promise.all(entries.map((e) => getPublicRecipe(e.id).catch(() => null)));
      return entries.map<SavedEntry>((e, i) => ({
        ...e,
        // Only live ones count as available (the owner could otherwise read their own hidden one).
        recipe: recipes[i] && recipes[i]!.status === "live" ? recipes[i] : null,
      }));
    },

    async getEngagement(publicId) {
      const uid = await currentUid();
      if (!uid) return { liked: false, saved: false };
      const [liked, saved] = await Promise.all(
        [PUBLIC_COLLECTIONS.likes, PUBLIC_COLLECTIONS.saves].map((kind) =>
          getDoc(doc(db, COLLECTIONS.users, uid, kind, publicId)).then(
            (s) => s.exists(),
            () => false,
          ),
        ),
      );
      return { liked, saved };
    },

    previewSource: (url) => api.previewSource(url),
    publish: async (id, body) => (await api.publish(id, body)).publicRecipe,
    unpublish: (id) => api.unpublish(id),
    setLike: (publicId, liked) => api.setLike(publicId, liked),
    setSave: (publicId, saved) => api.setSave(publicId, saved),
    copy: async (publicId) => (await api.copyPublic(publicId)).recipe,
    report: (publicId, body) => api.report(publicId, body),
    adminQueue: () => api.adminQueue(),
    adminAction: (publicId, body) => api.adminAction(publicId, body),
  };
}
