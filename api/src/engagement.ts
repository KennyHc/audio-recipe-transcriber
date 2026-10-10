/**
 * Likes, saves, and "Make a copy" on public recipes (contract: shared/public.ts). Only the
 * API writes users/{uid}/likes|saves/* and stats, each change in one transaction with the
 * counter, so the counts stay true.
 */
import { randomUUID } from "node:crypto";
import {
  type CopyResponse,
  type EngagementResponse,
  MAX_ENGAGEMENTS_PER_DAY,
  PUBLIC_COLLECTIONS,
  type PublicStats,
  popularityScore,
  type RecipeDoc,
  type VersionedRecipe,
} from "@recipe/shared";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { profileFromToken } from "./auth";
import { appError } from "./errors";
import { countUserActionOrThrow, writeUserFields } from "./ratelimit";
import { parsePublicDoc, publicRef, userRef } from "./publish";
import { recipeRef, versionRef } from "./recipes";
import { RECIPE_ID_PATTERN } from "./validation";

export type EngagementKind = "like" | "save";

const ZERO_STATS: PublicStats = { saves: 0, likes: 0, score: 0 };

/** Applies a +1/−1 like or save to stats, never below zero, recomputing the score. Pure. */
export function adjustStats(stats: PublicStats, delta: { likes?: number; saves?: number }): PublicStats {
  const likes = Math.max(0, stats.likes + (delta.likes ?? 0));
  const saves = Math.max(0, stats.saves + (delta.saves ?? 0));
  return { likes, saves, score: popularityScore({ likes, saves }) };
}

export function readStats(data: unknown): PublicStats {
  const s = (data as { stats?: Partial<PublicStats> } | undefined)?.stats;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0);
  const likes = n(s?.likes);
  const saves = n(s?.saves);
  return { likes, saves, score: popularityScore({ likes, saves }) };
}

const isLive = (snap: DocumentSnapshot) => snap.exists && (snap.data() as { status?: unknown }).status === "live";

/**
 * POST (on = true) or DELETE (on = false) /public/:id/like|save. Idempotent: repeating a
 * request changes nothing and doesn't count toward the daily limit.
 *
 * POST needs a live recipe (else 404). DELETE also works on a hidden or deleted one, so a
 * user can clear a "no longer available" save/like (the rules don't let the browser).
 */
export async function setEngagement(
  db: Firestore,
  user: DecodedIdToken,
  id: string,
  kind: EngagementKind,
  on: boolean,
  now: Date,
): Promise<EngagementResponse> {
  if (!RECIPE_ID_PATTERN.test(id)) throw appError("not_found");
  const pRef = publicRef(db, id);
  const uRef = userRef(db, user.uid);
  const likeRef = uRef.collection(PUBLIC_COLLECTIONS.likes).doc(id);
  const saveRef = uRef.collection(PUBLIC_COLLECTIONS.saves).doc(id);

  return db.runTransaction(async (tx) => {
    const [pSnap, uSnap, likeSnap, saveSnap] = (await tx.getAll(pRef, uRef, likeRef, saveRef)) as [
      DocumentSnapshot,
      DocumentSnapshot,
      DocumentSnapshot,
      DocumentSnapshot,
    ];
    const live = isLive(pSnap);
    if (on && !live) throw appError("not_found");

    const targetRef = kind === "like" ? likeRef : saveRef;
    const has = (kind === "like" ? likeSnap : saveSnap).exists;
    let stats = pSnap.exists ? readStats(pSnap.data()) : ZERO_STATS;

    if (has !== on) {
      const counter = countUserActionOrThrow(uSnap, "engagements", MAX_ENGAGEMENTS_PER_DAY, now);
      const delta = on ? 1 : -1;
      if (on) {
        tx.create(targetRef, kind === "like" ? { likedAt: now.toISOString() } : { savedAt: now.toISOString() });
      } else {
        tx.delete(targetRef);
      }
      if (pSnap.exists) {
        stats = adjustStats(stats, kind === "like" ? { likes: delta } : { saves: delta });
        tx.update(pRef, { stats });
      }
      writeUserFields(tx, uRef, uSnap, profileFromToken(user), now, {
        counter: { name: "engagements", state: counter },
      });
    }

    return {
      stats: live ? stats : ZERO_STATS,
      liked: kind === "like" ? on : likeSnap.exists,
      saved: kind === "save" ? on : saveSnap.exists,
    };
  });
}

/**
 * POST /public/:id/copy: a private, editable copy (new id, v1 "edited" with an attribution
 * note) of a live recipe — or the caller's own non-live one. No Claude, no quota; counts
 * toward the daily engagement limit so it can't be used to flood the database.
 */
export async function copyPublicRecipe(
  db: Firestore,
  user: DecodedIdToken,
  id: string,
  now: Date,
): Promise<CopyResponse> {
  if (!RECIPE_ID_PATTERN.test(id)) throw appError("not_found");
  const newId = randomUUID();
  const uRef = userRef(db, user.uid);

  return db.runTransaction(async (tx) => {
    const [pSnap, uSnap] = (await tx.getAll(publicRef(db, id), uRef)) as [DocumentSnapshot, DocumentSnapshot];
    if (!pSnap.exists) throw appError("not_found");
    const source = parsePublicDoc(pSnap.data());
    if (source.status !== "live" && source.ownerId !== user.uid) throw appError("not_found");

    const counter = countUserActionOrThrow(uSnap, "engagements", MAX_ENGAGEMENTS_PER_DAY, now);
    const nowIso = now.toISOString();
    const recipe = source.recipe;
    // RecipeDoc has no forkedFrom field (shared/cloud.ts), so the attribution is the note.
    const note = `Copied from @${source.handle}'s recipe`;
    const doc: RecipeDoc = {
      ownerId: user.uid,
      visibility: "private",
      title: recipe.title,
      fileName: `${recipe.title} (copied from @${source.handle})`.slice(0, 300),
      createdAt: nowIso,
      updatedAt: nowIso,
      currentVersion: 1,
      latest: recipe,
    };
    const version: VersionedRecipe = {
      meta: { version: 1, source: "edited", createdAt: nowIso, note },
      recipe,
    };
    tx.create(recipeRef(db, newId), doc);
    tx.create(versionRef(db, newId, 1), version);
    writeUserFields(tx, uRef, uSnap, profileFromToken(user), now, {
      counter: { name: "engagements", state: counter },
    });
    return { recipe: { ...doc, id: newId } };
  });
}
