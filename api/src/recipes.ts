/**
 * POST /recipes and POST /recipes/:id/reextract — the only ways AI output enters the
 * database, which is what makes the monthly quota real (see shared/cloud.ts).
 */
import {
  type CloudRecipe,
  COLLECTIONS,
  type CreateRecipeRequest,
  type CreateRecipeResponse,
  type Recipe,
  RecipeDoc,
  type Transcript,
  TRANSCRIPT_DOC_ID,
  TranscriptDoc,
  VersionedRecipe,
} from "@recipe/shared";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { profileFromToken } from "./auth";
import { appError, sanitizedErrorLog } from "./errors";
import { extractAndVerify, type PipelineDeps } from "./pipeline";
import { consumeQuotaOrThrow, currentUsage, refundQuota } from "./users";
import { assertTranscriptSizeOrThrow, RECIPE_ID_PATTERN } from "./validation";

export function recipeRef(db: Firestore, id: string): DocumentReference {
  return db.collection(COLLECTIONS.recipes).doc(id);
}

export function versionRef(db: Firestore, id: string, version: number): DocumentReference {
  return recipeRef(db, id).collection(COLLECTIONS.versions).doc(String(version));
}

export function transcriptRef(db: Firestore, id: string): DocumentReference {
  return recipeRef(db, id).collection(COLLECTIONS.private).doc(TRANSCRIPT_DOC_ID);
}

/** gRPC ALREADY_EXISTS, as raised by create() on an existing doc. */
export function isAlreadyExists(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 6;
}

export async function createRecipe(
  deps: PipelineDeps,
  user: DecodedIdToken,
  body: CreateRecipeRequest,
): Promise<{ status: 200 | 201; response: CreateRecipeResponse }> {
  const { db, config } = deps;
  assertTranscriptSizeOrThrow(body.transcript);

  // Idempotent on id: a retry after a lost response must not call Claude or count again.
  const existing = await existingRecipeResponse(deps, user, body.id);
  if (existing) return { status: 200, response: existing };

  const profile = profileFromToken(user);
  const quota = await consumeQuotaOrThrow(db, user.uid, profile, config.freeMonthlyRecipes, deps.now());
  try {
    const recipe = await extractAndVerify(deps, body.transcript);

    const nowIso = deps.now().toISOString();
    const doc: RecipeDoc = {
      ownerId: user.uid,
      visibility: "private",
      title: recipe.title,
      fileName: body.fileName,
      createdAt: nowIso,
      updatedAt: nowIso,
      currentVersion: 1,
      latest: recipe,
    };
    const version: VersionedRecipe = {
      meta: { version: 1, source: "extracted", createdAt: nowIso, note: null },
      recipe,
    };
    const transcriptDoc: TranscriptDoc = { transcript: body.transcript, updatedAt: nowIso };

    // One batch: the recipe never exists without its v1 and transcript. create() (not set)
    // so a concurrent request for the same id fails here instead of overwriting.
    const batch = db.batch();
    batch.create(recipeRef(db, body.id), doc);
    batch.create(versionRef(db, body.id, 1), version);
    batch.create(transcriptRef(db, body.id), transcriptDoc);
    await batch.commit();

    return { status: 201, response: { recipe: { ...doc, id: body.id }, version, usage: quota.usage } };
  } catch (err) {
    await refundSafely(deps, user.uid, quota.month);
    if (isAlreadyExists(err)) {
      // Lost a race with a concurrent request for the same id: answer like a retry would.
      const raced = await existingRecipeResponse(deps, user, body.id);
      if (raced) return { status: 200, response: raced };
    }
    throw err;
  }
}

/** The idempotent-replay answer, or null if the recipe doesn't exist yet. */
async function existingRecipeResponse(
  deps: PipelineDeps,
  user: DecodedIdToken,
  id: string,
): Promise<CreateRecipeResponse | null> {
  const { db, config } = deps;
  const snap = await recipeRef(db, id).get();
  if (!snap.exists) return null;
  const doc = parseRecipeDoc(snap.data());
  // Ids are client-generated UUIDs, so a clash with another account is a client bug — or a
  // probe; either way don't hand out the other user's data.
  if (doc.ownerId !== user.uid) throw appError("conflict", null, "That recipe id is already in use.");

  const versionSnap = await versionRef(db, id, doc.currentVersion).get();
  const version = VersionedRecipe.safeParse(versionSnap.data());
  if (!version.success) throw new Error("latest version doc missing or invalid");

  const { usage } = await currentUsage(db, user.uid, profileFromToken(user), config.freeMonthlyRecipes, deps.now());
  return { recipe: { ...doc, id }, version: version.data, usage };
}

export async function reextractRecipe(
  deps: PipelineDeps,
  user: DecodedIdToken,
  id: string,
): Promise<CreateRecipeResponse> {
  const { db, config } = deps;
  if (!RECIPE_ID_PATTERN.test(id)) throw appError("not_found");

  const snap = await recipeRef(db, id).get();
  // Someone else's recipe looks exactly like a missing one: don't confirm ids exist.
  if (!snap.exists || parseRecipeDoc(snap.data()).ownerId !== user.uid) throw appError("not_found");

  const transcript = await readSavedTranscript(db, id);
  assertTranscriptSizeOrThrow(transcript);

  const quota = await consumeQuotaOrThrow(db, user.uid, profileFromToken(user), config.freeMonthlyRecipes, deps.now());
  try {
    const recipe = await extractAndVerify(deps, transcript);
    const saved = await saveNextVersion(deps, user.uid, id, recipe);
    return { ...saved, usage: quota.usage };
  } catch (err) {
    await refundSafely(deps, user.uid, quota.month);
    throw err;
  }
}

async function readSavedTranscript(db: Firestore, id: string): Promise<Transcript> {
  const snap = await transcriptRef(db, id).get();
  if (!snap.exists) throw appError("conflict", null, "There's no saved transcript to re-extract from.");
  // The browser may rewrite this doc (rules check only its rough shape), so validate it.
  const parsed = TranscriptDoc.safeParse(snap.data());
  if (!parsed.success) throw appError("conflict", null, "The saved transcript couldn't be read.");
  return parsed.data.transcript;
}

/** Appends versions/{n+1} ("reextracted") and moves the recipe's latest fields to it, atomically. */
async function saveNextVersion(
  deps: PipelineDeps,
  uid: string,
  id: string,
  recipe: Recipe,
): Promise<{ recipe: CloudRecipe; version: VersionedRecipe }> {
  const { db } = deps;
  const ref = recipeRef(db, id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // Deleted (or, impossibly, re-owned) while Claude was running.
    if (!snap.exists) throw appError("not_found");
    const doc = parseRecipeDoc(snap.data());
    if (doc.ownerId !== uid) throw appError("not_found");

    const n = doc.currentVersion + 1;
    const nowIso = deps.now().toISOString();
    const version: VersionedRecipe = {
      meta: { version: n, source: "reextracted", createdAt: nowIso, note: null },
      recipe,
    };
    const updated: RecipeDoc = { ...doc, latest: recipe, title: recipe.title, updatedAt: nowIso, currentVersion: n };
    tx.create(versionRef(db, id, n), version);
    tx.update(ref, { latest: recipe, title: recipe.title, updatedAt: nowIso, currentVersion: n });
    return { recipe: { ...updated, id }, version };
  });
}

function parseRecipeDoc(data: unknown): RecipeDoc {
  const parsed = RecipeDoc.safeParse(data);
  if (!parsed.success) throw new Error("recipe doc failed validation");
  return parsed.data;
}

async function refundSafely(deps: PipelineDeps, uid: string, month: string): Promise<void> {
  try {
    await refundQuota(deps.db, uid, month);
  } catch (err) {
    deps.logger.log("ERROR", "quota refund failed", {
      uid,
      error: sanitizedErrorLog(err, [deps.config.anthropicApiKey]),
    });
  }
}
