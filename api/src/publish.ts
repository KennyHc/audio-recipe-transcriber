/**
 * POST /recipes/:id/publish and DELETE /recipes/:id/publish (contract: shared/public.ts).
 *
 * Publish = owner check → handle + daily limit (one transaction on users/{uid}) → resolve
 * the credit (oEmbed) → duplicate-video pre-check → Haiku screening (global daily budget,
 * never the user's quota; fails SAFE to "review") → one transaction that re-checks the
 * duplicate and writes publicRecipes/{id} + sources/{key} (+ a screening report) together.
 */
import {
  COLLECTIONS,
  formatScreeningInput,
  MAX_PUBLISHES_PER_DAY,
  PUBLIC_COLLECTIONS,
  type PublicRecipeDoc,
  PublicRecipeDoc as PublicRecipeDocSchema,
  type PublicStatus,
  type PublishRequest,
  type PublishResponse,
  type Recipe,
  RecipeDoc,
  type RecipeSource,
  type ReportDoc,
  SCREENING_SYSTEM,
  ScreeningOutput,
  searchTerms,
  type SourceInput,
} from "@recipe/shared";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { profileFromToken } from "./auth";
import { SCREEN_MAX_TOKENS } from "./claude/types";
import { AppError, appError, duplicateVideoError } from "./errors";
import { budgetedCall, type PipelineDeps } from "./pipeline";
import { countUserActionOrThrow, writeUserFields } from "./ratelimit";
import { recipeRef } from "./recipes";
import { existingLivePublicId, type FetchLike, isLivePublic, lookupSource, type ResolvedLink, sourceRef } from "./sources";
import { RECIPE_ID_PATTERN } from "./validation";

export interface PublicDeps extends PipelineDeps {
  fetch: FetchLike;
}

export function publicRef(db: Firestore, id: string): DocumentReference {
  return db.collection(PUBLIC_COLLECTIONS.publicRecipes).doc(id);
}

export function handleRef(db: Firestore, handle: string): DocumentReference {
  return db.collection(PUBLIC_COLLECTIONS.handles).doc(handle);
}

export function userRef(db: Firestore, uid: string): DocumentReference {
  return db.collection(COLLECTIONS.users).doc(uid);
}

export function parsePublicDoc(data: unknown): PublicRecipeDoc {
  const parsed = PublicRecipeDocSchema.safeParse(data);
  if (!parsed.success) throw new Error("public recipe doc failed validation");
  return parsed.data;
}

export function readHandle(data: unknown): string | null {
  const handle = (data as { handle?: unknown } | undefined)?.handle;
  return typeof handle === "string" ? handle : null;
}

/** The sources/{key} doc a public recipe claims (public youtube/tiktok only), or null. */
export function claimedSourceRef(
  db: Firestore,
  doc: Pick<PublicRecipeDoc, "visibility" | "source">,
): DocumentReference | null {
  const { platform, videoId } = doc.source;
  if (doc.visibility !== "public" || !videoId || (platform !== "youtube" && platform !== "tiktok")) return null;
  return sourceRef(db, platform, videoId);
}

export const SCREENING_UNAVAILABLE = "screening unavailable";

const HANDLE_REQUIRED = "Choose a handle (3–20 lowercase letters, digits, or _) for your first publish.";
const CREDIT_REQUIRED = "Please type the creator's name for this link.";

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export async function publishRecipe(
  deps: PublicDeps,
  user: DecodedIdToken,
  id: string,
  body: PublishRequest,
): Promise<PublishResponse> {
  const { db, logger } = deps;
  if (!RECIPE_ID_PATTERN.test(id)) throw appError("not_found");

  // 1. Owner only; someone else's recipe looks exactly like a missing one.
  const recipeSnap = await recipeRef(db, id).get();
  const recipe = recipeSnap.exists ? RecipeDoc.safeParse(recipeSnap.data()) : null;
  if (!recipe?.success || recipe.data.ownerId !== user.uid) throw appError("not_found");
  // The snapshot is what was screened: this read of latest/currentVersion.
  const latest = recipe.data.latest;
  const sourceVersion = recipe.data.currentVersion;

  // 2. Handle (reserved on first publish) + the daily publish limit, atomically.
  const handle = await reserveHandleAndCountPublish(deps, user, body.handle);

  // 3. Credit (oEmbed for YouTube/TikTok).
  const { source, link } = await resolvePublishSource(deps.fetch, body.source);
  const claimsVideo = body.visibility === "public" && link !== null && link.platform !== "other" && link.videoId !== null;

  // 4. Cheap duplicate pre-check before spending on screening (re-checked in the write).
  if (claimsVideo) {
    const existing = await existingLivePublicId(db, link);
    if (existing && existing !== id) throw duplicateVideoError(existing);
  }

  // 5. Screening (never fails open).
  const screening = await screenForPublish(deps, latest, handle, source);

  // 6. Write the snapshot (+ source mapping, + screening report) in one transaction.
  const result = await db.runTransaction(async (tx) => {
    const rRef = recipeRef(db, id);
    const pRef = publicRef(db, id);
    const rSnap = await tx.get(rRef);
    const rDoc = rSnap.exists ? RecipeDoc.safeParse(rSnap.data()) : null;
    if (!rDoc?.success || rDoc.data.ownerId !== user.uid) throw appError("not_found"); // deleted meanwhile

    const pSnap = await tx.get(pRef);
    const existing = pSnap.exists ? parsePublicDoc(pSnap.data()) : null;

    const newKeyRef = claimsVideo ? sourceRef(db, link.platform, link.videoId!) : null;
    const oldKeyRef = existing ? claimedSourceRef(db, existing) : null;
    if (newKeyRef) await assertNoLiveDuplicate(tx, db, newKeyRef, id);
    const oldMapping = oldKeyRef && oldKeyRef.path !== newKeyRef?.path ? await tx.get(oldKeyRef) : null;

    const nowIso = deps.now().toISOString();
    // An admin-hidden recipe stays hidden through updates; only an admin restores it.
    const status: PublicStatus =
      existing?.status === "hidden" ? "hidden" : screening.flagged ? "review" : "live";
    const doc: PublicRecipeDoc = {
      ownerId: user.uid,
      handle,
      visibility: body.visibility,
      status,
      recipe: latest,
      sourceVersion,
      source,
      tags: [...new Set(body.tags)],
      terms: searchTerms(latest, body.tags),
      stats: existing?.stats ?? { saves: 0, likes: 0, score: 0 },
      publishedAt: existing?.publishedAt ?? nowIso,
      updatedAt: nowIso,
    };

    tx.set(pRef, doc);
    if (newKeyRef) tx.set(newKeyRef, { publicRecipeId: id });
    if (oldKeyRef && oldMapping && mappedId(oldMapping.data()) === id) tx.delete(oldKeyRef);
    tx.update(rRef, { visibility: body.visibility });
    if (screening.flagged) {
      const report: ReportDoc = {
        publicRecipeId: id,
        kind: "screening",
        reason: screening.reason,
        contact: null,
        reporterUid: null,
        status: "open",
        createdAt: nowIso,
        resolvedAt: null,
        resolution: null,
      };
      tx.create(db.collection(PUBLIC_COLLECTIONS.reports).doc(), report);
    }
    return doc;
  });

  if (screening.flagged) {
    // Cloud Monitoring log-based alert keys on this event. No recipe text or reason here.
    logger.log("WARNING", "publish flagged", {
      event: "publish_flagged",
      publicRecipeId: id,
      screening: screening.unavailable ? "unavailable" : "review",
    });
  }
  return { publicRecipe: { ...result, id } };
}

function mappedId(data: unknown): string | null {
  const id = (data as { publicRecipeId?: unknown } | undefined)?.publicRecipeId;
  return typeof id === "string" ? id : null;
}

/** Inside a transaction: 409 if sources/{key} points to ANOTHER live, public recipe. */
async function assertNoLiveDuplicate(tx: Transaction, db: Firestore, keyRef: DocumentReference, id: string) {
  const other = mappedId((await tx.get(keyRef)).data());
  if (!other || other === id) return;
  const otherSnap = await tx.get(publicRef(db, other));
  if (isLivePublic(otherSnap.data())) throw duplicateVideoError(other);
}

/**
 * One transaction on users/{uid}: require/reserve the handle and count today's publish.
 * Nothing is counted or reserved if any check fails. Returns the handle to show.
 */
async function reserveHandleAndCountPublish(
  deps: PublicDeps,
  user: DecodedIdToken,
  requested: string | null,
): Promise<string> {
  const { db } = deps;
  const now = deps.now();
  const uRef = userRef(db, user.uid);
  return db.runTransaction(async (tx) => {
    const uSnap = await tx.get(uRef);
    const current = readHandle(uSnap.data());
    if (!current && !requested) throw appError("bad_request", null, HANDLE_REQUIRED);

    let reserve: string | null = null;
    if (!current) {
      const hSnap = await tx.get(handleRef(db, requested!));
      const owner = (hSnap.data() as { uid?: unknown } | undefined)?.uid;
      if (hSnap.exists && owner !== user.uid) throw appError("handle_taken");
      reserve = requested!;
    }

    const counter = countUserActionOrThrow(uSnap, "publishes", MAX_PUBLISHES_PER_DAY, now);
    if (reserve) tx.set(handleRef(db, reserve), { uid: user.uid });
    writeUserFields(tx, uRef, uSnap, profileFromToken(user), now, {
      counter: { name: "publishes", state: counter },
      extra: reserve ? { handle: reserve } : {},
    });
    return (current ?? reserve)!;
  });
}

const NO_CREDIT = { title: null, channelName: null, channelUrl: null, thumbnailUrl: null } as const;

/**
 * SourceInput → stored RecipeSource. YouTube/TikTok credit always comes from oEmbed (a
 * creditName sent for them is ignored); other sites use the typed creditName. A YouTube/
 * TikTok link entered as "Somewhere else" is treated as the video it is, so the credit
 * (and the one-page-per-video rule) can't be sidestepped.
 */
export async function resolvePublishSource(
  fetchFn: FetchLike,
  input: SourceInput,
): Promise<{ source: RecipeSource; link: ResolvedLink | null }> {
  if (input.kind === "own") {
    return {
      source: { kind: "own", platform: null, videoId: null, url: null, ...NO_CREDIT, startOffsetSeconds: 0 },
      link: null,
    };
  }

  const { link, credit } = await lookupSource(fetchFn, input.url);
  const startOffsetSeconds = input.kind === "video" ? input.startOffsetSeconds : 0;

  if (link.platform !== "other") {
    return {
      source: { kind: "video", platform: link.platform, videoId: link.videoId, url: link.url, ...credit, startOffsetSeconds },
      link,
    };
  }
  const creditName = input.creditName?.trim();
  if (!creditName) throw appError("bad_request", null, CREDIT_REQUIRED);
  return {
    source: {
      kind: input.kind,
      platform: "other",
      videoId: null,
      url: link.url,
      ...NO_CREDIT,
      channelName: creditName,
      startOffsetSeconds,
    },
    link,
  };
}

interface ScreeningVerdict {
  flagged: boolean;
  reason: string;
  /** Screening couldn't run (budget, API error) — flagged as a fail-safe. */
  unavailable: boolean;
}

/** Haiku screening under the global daily budget. Any failure → flagged ("review"). */
async function screenForPublish(
  deps: PublicDeps,
  recipe: Recipe,
  handle: string,
  source: RecipeSource,
): Promise<ScreeningVerdict> {
  const message = formatScreeningInput({
    recipe,
    handle,
    credit: { name: source.channelName, title: source.title, url: source.url },
  });
  try {
    const raw = await budgetedCall(
      deps,
      "screen",
      deps.config.screeningModel,
      message.length + SCREENING_SYSTEM.length,
      SCREEN_MAX_TOKENS,
      () => deps.claude.screen(message),
    );
    const parsed = ScreeningOutput.safeParse(raw);
    if (!parsed.success) throw new Error("screening output failed validation");
    return {
      flagged: parsed.data.decision === "review",
      reason: parsed.data.reason.trim().slice(0, 500) || "flagged by screening",
      unavailable: false,
    };
  } catch (err) {
    deps.logger.log("WARNING", "screening unavailable", {
      code: err instanceof AppError ? err.code : "invalid_output",
    });
    return { flagged: true, reason: SCREENING_UNAVAILABLE, unavailable: true };
  }
}

// ---------------------------------------------------------------------------
// Unpublish
// ---------------------------------------------------------------------------

/**
 * Deletes publicRecipes/{id} and its sources mapping (if it points here), and marks the
 * private recipe private again. `allowed(ownerId)` decides who may (owner or admin).
 * A missing snapshot is a no-op (idempotent). Returns false if not allowed.
 */
export async function unpublishById(
  db: Firestore,
  id: string,
  allowed: (ownerId: string) => boolean,
): Promise<boolean> {
  const pRef = publicRef(db, id);
  return db.runTransaction(async (tx) => {
    const pSnap = await tx.get(pRef);
    if (!pSnap.exists) return true;
    const data = pSnap.data() as Partial<PublicRecipeDoc>;
    if (typeof data.ownerId !== "string" || !allowed(data.ownerId)) return false;

    const parsed = PublicRecipeDocSchema.pick({ visibility: true, source: true }).safeParse(data);
    const keyRef = parsed.success ? claimedSourceRef(db, parsed.data) : null;
    const mapping = keyRef ? await tx.get(keyRef) : null;
    const rRef = recipeRef(db, id);
    const rSnap = await tx.get(rRef);

    tx.delete(pRef);
    if (keyRef && mapping && mappedId(mapping.data()) === id) tx.delete(keyRef);
    if (rSnap.exists && (rSnap.data() as { ownerId?: unknown }).ownerId === data.ownerId) {
      tx.update(rRef, { visibility: "private" });
    }
    return true;
  });
}

export async function unpublishRecipe(db: Firestore, user: DecodedIdToken, id: string, isAdmin: boolean): Promise<void> {
  if (!RECIPE_ID_PATTERN.test(id)) throw appError("not_found");
  const ok = await unpublishById(db, id, (ownerId) => ownerId === user.uid || isAdmin);
  if (!ok) throw appError("not_found");
}
