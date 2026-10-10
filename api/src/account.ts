/** GET /me and DELETE /me. */
import { COLLECTIONS, type MeResponse, PUBLIC_COLLECTIONS, type PublicStats } from "@recipe/shared";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { type AuthAdmin, profileFromToken } from "./auth";
import { adjustStats, readStats } from "./engagement";
import { sanitizedErrorLog } from "./errors";
import { type Logger, silentLogger } from "./log";
import { isAdminToken } from "./moderation";
import { handleRef, publicRef, readHandle, unpublishById, userRef } from "./publish";
import { currentUsage } from "./users";

export async function getMe(
  db: Firestore,
  user: DecodedIdToken,
  limit: number,
  now: Date,
): Promise<MeResponse> {
  const { user: doc, usage } = await currentUsage(db, user.uid, profileFromToken(user), limit, now);
  // UserDoc (shared/cloud.ts) doesn't model the Phase 2 handle field, so read it raw.
  const handle = readHandle((await userRef(db, user.uid).get()).data());
  return {
    uid: user.uid,
    email: user.email ?? doc.email,
    plan: doc.plan,
    handle,
    isAdmin: isAdminToken(user),
    usage,
  };
}

/**
 * Deletes the user's public footprint first (public recipes + source mappings, handle,
 * likes/saves with their counts), then every recipe they own (with versions + transcript),
 * then the user doc, then the Auth user — in that order, so a failure part-way leaves a
 * still-signed-in user who can simply retry, never orphaned data without an account to
 * delete it from.
 */
export async function deleteAccount(
  db: Firestore,
  auth: AuthAdmin,
  uid: string,
  logger: Logger = silentLogger,
): Promise<void> {
  await deletePublicFootprint(db, uid, logger);

  const owned = await db.collection(COLLECTIONS.recipes).where("ownerId", "==", uid).select().get();
  for (const doc of owned.docs) {
    await db.recursiveDelete(doc.ref);
  }
  await anonymizeReports(db, uid);

  // recursiveDelete (not delete) so per-user subcollections (saves, likes) go too.
  await db.recursiveDelete(userRef(db, uid));

  try {
    await auth.deleteUser(uid);
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code !== "auth/user-not-found") throw err;
  }
}

/**
 * Reports they filed stay in the moderation queue (they may concern someone else's recipe),
 * but without anything that identifies them: no uid, no contact email (GDPR).
 */
async function anonymizeReports(db: Firestore, uid: string): Promise<void> {
  const filed = await db.collection(PUBLIC_COLLECTIONS.reports).where("reporterUid", "==", uid).select().get();
  for (let i = 0; i < filed.docs.length; i += 400) {
    const batch = db.batch();
    for (const d of filed.docs.slice(i, i + 400)) batch.update(d.ref, { reporterUid: null, contact: null });
    await batch.commit();
  }
}

/** Public recipes updated per transaction when giving back a deleted user's likes/saves. */
const STATS_CHUNK = 100;

async function deletePublicFootprint(db: Firestore, uid: string, logger: Logger): Promise<void> {
  // 1. Unpublish everything they own (snapshot + sources mapping). Must succeed.
  const published = await db.collection(PUBLIC_COLLECTIONS.publicRecipes).where("ownerId", "==", uid).select().get();
  for (const doc of published.docs) {
    await unpublishById(db, doc.id, (ownerId) => ownerId === uid);
  }

  // 2. Free the handle (only if it's still theirs).
  const uRef = userRef(db, uid);
  const handle = readHandle((await uRef.get()).data());
  if (handle) {
    const hRef = handleRef(db, handle);
    await db.runTransaction(async (tx) => {
      const hSnap = await tx.get(hRef);
      if (hSnap.exists && (hSnap.data() as { uid?: unknown }).uid === uid) tx.delete(hRef);
    });
  }

  // 3. Give back their likes/saves on recipes that still exist (best effort: counts are
  //    cosmetic; the like/save docs themselves go with the user doc's recursiveDelete).
  try {
    const [likes, saves] = await Promise.all([
      uRef.collection(PUBLIC_COLLECTIONS.likes).select().get(),
      uRef.collection(PUBLIC_COLLECTIONS.saves).select().get(),
    ]);
    const deltas = new Map<string, { likes: number; saves: number }>();
    for (const d of likes.docs) deltas.set(d.id, { likes: -1, saves: deltas.get(d.id)?.saves ?? 0 });
    for (const d of saves.docs) deltas.set(d.id, { likes: deltas.get(d.id)?.likes ?? 0, saves: -1 });

    const ids = [...deltas.keys()];
    for (let i = 0; i < ids.length; i += STATS_CHUNK) {
      const chunk = ids.slice(i, i + STATS_CHUNK);
      await db.runTransaction(async (tx) => {
        const snaps = await tx.getAll(...chunk.map((id) => publicRef(db, id)));
        for (const snap of snaps) {
          if (!snap.exists) continue;
          const stats: PublicStats = adjustStats(readStats(snap.data()), deltas.get(snap.id)!);
          tx.update(snap.ref, { stats });
        }
      });
    }
  } catch (err) {
    logger.log("ERROR", "account deletion: like/save counts not fully updated", {
      uid,
      error: sanitizedErrorLog(err, []),
    });
  }
}
