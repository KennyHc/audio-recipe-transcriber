/**
 * users/{uid}: created on first contact from the ID token's profile claims, and the
 * transactional quota counter. Only the API writes these docs (rules deny client writes).
 */
import { COLLECTIONS, type Usage, UserDoc } from "@recipe/shared";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { countStat } from "./stats";
import { appError } from "./errors";
import { refundUsage, toUsage, tryConsume, type UsageState } from "./quota";
import { utcMonthString } from "./time";

/** The profile fields we copy from the verified ID token. */
export interface UserProfile {
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export function newUserDoc(profile: UserProfile, now: Date): UserDoc {
  return {
    ...profile,
    plan: "free",
    createdAt: now.toISOString(),
    usage: { month: utcMonthString(now), recipesCreated: 0 },
  };
}

function userRef(db: Firestore, uid: string): DocumentReference {
  return db.collection(COLLECTIONS.users).doc(uid);
}

/**
 * Reads users/{uid} inside `tx`; if missing, returns a fresh doc for the caller to create
 * (a transaction may write each doc only once, so the caller does the single write). A doc that doesn't match UserDoc
 * (shouldn't happen — only we write it) is an internal error rather than silently reset,
 * since resetting would also reset the quota.
 */
async function readOrNewInTx(
  tx: Transaction,
  ref: DocumentReference,
  profile: UserProfile,
  now: Date,
): Promise<{ doc: UserDoc; created: boolean }> {
  const snap = await tx.get(ref);
  if (!snap.exists) {
    return { doc: newUserDoc(profile, now), created: true };
  }
  const parsed = UserDoc.safeParse(snap.data());
  if (!parsed.success) throw new Error(`users doc failed validation`);
  return { doc: parsed.data, created: false };
}

export async function getOrCreateUser(db: Firestore, uid: string, profile: UserProfile, now: Date): Promise<UserDoc> {
  const ref = userRef(db, uid);
  let createdNow = false; // set by the attempt that commits (transactions may retry)
  const doc = await db.runTransaction(async (tx) => {
    const { doc, created } = await readOrNewInTx(tx, ref, profile, now);
    createdNow = created;
    if (created) tx.create(ref, doc);
    return doc;
  });
  if (createdNow) await countStat(db, "signup", now);
  return doc;
}

export interface ConsumedQuota {
  /** Usage after counting this recipe. */
  usage: Usage;
  /** The month the recipe was counted in — what a refund must target. */
  month: string;
}

/** Counts one recipe against this month's quota, or throws 429 quota_exceeded. */
export async function consumeQuotaOrThrow(
  db: Firestore,
  uid: string,
  profile: UserProfile,
  limit: number,
  now: Date,
): Promise<ConsumedQuota> {
  const ref = userRef(db, uid);
  let createdNow = false;
  const result = await db.runTransaction(async (tx) => {
    const { doc, created } = await readOrNewInTx(tx, ref, profile, now);
    createdNow = created;
    const consumed = tryConsume(doc.usage, now, limit);
    if (!consumed.ok) {
      if (created) tx.create(ref, doc);
      return consumed;
    }
    if (created) {
      tx.create(ref, { ...doc, usage: consumed.state });
    } else {
      tx.update(ref, { usage: consumed.state });
    }
    return consumed;
  });
  if (createdNow) await countStat(db, "signup", now);
  if (!result.ok) throw appError("quota_exceeded", result.retryAfterSeconds);
  return { usage: toUsage(result.state, now, limit), month: result.state.month };
}

/** Gives back a recipe counted in `month` (users shouldn't lose quota to our errors). */
export async function refundQuota(db: Firestore, uid: string, month: string): Promise<void> {
  const ref = userRef(db, uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const usage = (snap.data() as { usage?: UsageState } | undefined)?.usage;
    const refunded = refundUsage(usage, month);
    if (refunded) tx.update(ref, { usage: refunded });
  });
}

export async function currentUsage(
  db: Firestore,
  uid: string,
  profile: UserProfile,
  limit: number,
  now: Date,
): Promise<{ user: UserDoc; usage: Usage }> {
  const user = await getOrCreateUser(db, uid, profile, now);
  return { user, usage: toUsage(user.usage, now, limit) };
}
