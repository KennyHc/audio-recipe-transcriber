/** GET /me and DELETE /me. */
import { COLLECTIONS, type MeResponse } from "@recipe/shared";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { type AuthAdmin, profileFromToken } from "./auth";
import { currentUsage } from "./users";

export async function getMe(
  db: Firestore,
  user: DecodedIdToken,
  limit: number,
  now: Date,
): Promise<MeResponse> {
  const { user: doc, usage } = await currentUsage(db, user.uid, profileFromToken(user), limit, now);
  return { uid: user.uid, email: user.email ?? doc.email, plan: doc.plan, usage };
}

/**
 * Deletes every recipe the user owns (with versions + transcript), then the user doc, then
 * the Auth user — in that order, so a failure part-way leaves a still-signed-in user who can
 * simply retry, never orphaned data without an account to delete it from.
 */
export async function deleteAccount(db: Firestore, auth: AuthAdmin, uid: string): Promise<void> {
  const owned = await db.collection(COLLECTIONS.recipes).where("ownerId", "==", uid).select().get();
  for (const doc of owned.docs) {
    await db.recursiveDelete(doc.ref);
  }
  // recursiveDelete (not delete) so future per-user subcollections (saves, likes) go too.
  await db.recursiveDelete(db.collection(COLLECTIONS.users).doc(uid));

  try {
    await auth.deleteUser(uid);
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code !== "auth/user-not-found") throw err;
  }
}
