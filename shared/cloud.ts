import { z } from "zod";
import { VersionedRecipe } from "./api";
import { BackupJob } from "./backup";
import { Recipe, Transcript } from "./recipe";

// Contract for the signed-in SaaS mode ("cloud"): Firebase Auth + Firestore (eur3) + the
// Cloud Run API in api/. See PHASE1-PLAN.md.
//
// Who writes what:
//   - The API (firebase-admin, bypasses rules) creates recipes, writes "extracted" and
//     "reextracted" versions, creates transcripts, owns users/{uid}.usage and system/*.
//     That's what makes the monthly quota real: AI output can only enter through it.
//   - The browser (Firestore SDK, checked by firebase/firestore.rules) reads its own data,
//     saves "edited"/"rollback" versions, updates its own transcript, deletes its recipes.
//
// HTTP API — every route needs both headers:
//     Authorization: Bearer <Firebase ID token>
//     X-Firebase-AppCheck: <App Check token>
//
//   POST   /recipes                  CreateRecipeRequest  -> CreateRecipeResponse (201)
//          Extract + verify the transcript, save recipe + v1 ("extracted") + transcript.
//          Counts 1 against the monthly quota. Idempotent on `id`: if the recipe already
//          exists for this user, returns it (200) without calling Claude or counting.
//   POST   /recipes/:id/reextract     {}                   -> ReextractResponse
//          Re-runs extract + verify on the SAVED transcript (the client updates the
//          transcript doc first), saves a new "reextracted" version. Counts 1.
//   POST   /import                    ImportRequest        -> ImportResponse
//          Moves a local (IndexedDB) library into the account. Never calls Claude, doesn't
//          count. Skips ids that already exist.
//   GET    /me                                             -> MeResponse
//          Creates users/{uid} on first call.
//   DELETE /me                                             -> 204
//          Deletes every recipe (with versions + transcript), the user doc, and the Auth user.
//
// Errors: non-2xx with body CloudError.

export const APP_CHECK_HEADER = "X-Firebase-AppCheck";

// ---------------------------------------------------------------------------
// Firestore layout
// ---------------------------------------------------------------------------

export const COLLECTIONS = {
  users: "users",
  recipes: "recipes",
  versions: "versions", // subcollection of recipes/{id}; doc id = String(version)
  private: "private", // subcollection of recipes/{id}; only doc: "transcript"
  system: "system", // budget-YYYY-MM-DD docs
} as const;
export const TRANSCRIPT_DOC_ID = "transcript";

export const budgetDocId = (utcDate: string) => `budget-${utcDate}`;

/** Phase 1 only allows "private"; "unlisted" and "public" arrive with publishing (Phase 2). */
export const Visibility = z.enum(["private", "unlisted", "public"]);
export type Visibility = z.infer<typeof Visibility>;

export const Plan = z.enum(["free"]);
export type Plan = z.infer<typeof Plan>;

/** users/{uid} */
export const UserDoc = z.object({
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  photoURL: z.string().nullable(),
  plan: Plan,
  createdAt: z.string(), // ISO
  usage: z.object({
    month: z.string(), // UTC "YYYY-MM"; a different month means the count is 0
    recipesCreated: z.number().int(),
  }),
});
export type UserDoc = z.infer<typeof UserDoc>;

/** recipes/{id}. `latest` duplicates the current version so the library list is one query. */
export const RecipeDoc = z.object({
  ownerId: z.string(),
  visibility: Visibility,
  title: z.string(),
  fileName: z.string(),
  createdAt: z.string(), // ISO
  updatedAt: z.string(), // ISO; the library is ordered by this (index: ownerId, updatedAt desc)
  currentVersion: z.number().int(), // == latest version number
  latest: Recipe,
});
export type RecipeDoc = z.infer<typeof RecipeDoc>;

/** recipes/{id}/versions/{n} is a VersionedRecipe (shared/api.ts); recipes/{id}/private/transcript: */
export const TranscriptDoc = z.object({
  transcript: Transcript,
  updatedAt: z.string(), // ISO
});
export type TranscriptDoc = z.infer<typeof TranscriptDoc>;

/** system/budget-YYYY-MM-DD — global daily Claude spend (API only). */
export const BudgetDoc = z.object({
  reservedUsd: z.number(),
  settledUsd: z.number(),
});
export type BudgetDoc = z.infer<typeof BudgetDoc>;

/** Version sources the browser may write itself; the rest only come from the API. */
export const CLIENT_VERSION_SOURCES = ["edited", "rollback"] as const;

// ---------------------------------------------------------------------------
// Limits (defaults; the API reads overrides from env)
// ---------------------------------------------------------------------------

export const FREE_MONTHLY_RECIPES = 30;
export const DEFAULT_DAILY_BUDGET_USD = 2;
/** Max recipes in one /import call; the client splits bigger libraries. */
export const MAX_IMPORT_JOBS = 50;
// Transcript size cap: MAX_TRANSCRIPT_CHARS in ./proxy (same for every hosted mode).

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

export const Usage = z.object({
  month: z.string(), // UTC "YYYY-MM"
  used: z.number().int(),
  limit: z.number().int(),
  remaining: z.number().int(), // never negative
  resetsAt: z.string(), // ISO, first instant of next UTC month
});
export type Usage = z.infer<typeof Usage>;

/** A recipe as the client sees it: the doc plus its id. */
export const CloudRecipe = RecipeDoc.extend({ id: z.string() });
export type CloudRecipe = z.infer<typeof CloudRecipe>;

export const CreateRecipeRequest = z.object({
  /** Client-generated UUID — the same id as the local job, so the device keeps its audio. */
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  fileName: z.string().min(1).max(300),
  transcript: Transcript,
});
export type CreateRecipeRequest = z.infer<typeof CreateRecipeRequest>;

export const CreateRecipeResponse = z.object({
  recipe: CloudRecipe,
  version: VersionedRecipe,
  usage: Usage,
});
export type CreateRecipeResponse = z.infer<typeof CreateRecipeResponse>;

export const ReextractResponse = CreateRecipeResponse;
export type ReextractResponse = CreateRecipeResponse;

/** Backup jobs without audio (audio never leaves the device). Only jobs with ≥1 version. */
export const ImportRequest = z.object({
  jobs: z.array(BackupJob.extend({ audio: z.null() })).max(MAX_IMPORT_JOBS),
});
export type ImportRequest = z.infer<typeof ImportRequest>;

export const ImportResponse = z.object({
  imported: z.array(z.string()), // ids
  skipped: z.array(z.string()), // already existed, or had no versions
});
export type ImportResponse = z.infer<typeof ImportResponse>;

export const MeResponse = z.object({
  uid: z.string(),
  email: z.string().nullable(),
  plan: Plan,
  handle: z.string().nullable(), // Phase 2: chosen on first publish (users/{uid}.handle)
  isAdmin: z.boolean(), // Phase 2: the ID token's `admin` custom claim
  usage: Usage,
});
export type MeResponse = z.infer<typeof MeResponse>;

export const CloudErrorCode = z.enum([
  "bad_request", // 400: body failed validation
  "unauthenticated", // 401: missing/invalid/expired ID token
  "app_check_failed", // 401: missing/invalid App Check token
  "not_found", // 404: no such recipe for this user
  "conflict", // 409: e.g. re-extract with no saved transcript
  "too_large", // 413: transcript over MAX_TRANSCRIPT_CHARS
  "quota_exceeded", // 429: this account used this month's recipes
  "budget_exhausted", // 503: the app's daily spend cap is reached for everyone
  "upstream_error", // 502: Claude call failed (refusal, max_tokens, API error)
  "internal", // 500
  // Phase 2 (shared/public.ts)
  "forbidden", // 403: e.g. admin route without the admin claim
  "rate_limited", // 429: too many publishes / likes / reports today (not the monthly quota)
  "handle_taken", // 409: the requested handle belongs to someone else
  "duplicate_video", // 409: this video already has a public recipe (see existingPublicId)
  "source_unavailable", // 422: the video link couldn't be looked up (private, removed, bad URL)
]);
export type CloudErrorCode = z.infer<typeof CloudErrorCode>;

export const CloudError = z.object({
  error: z.string(), // human-readable, safe to show the user
  code: CloudErrorCode,
  retryAfterSeconds: z.number().nullable(),
  /** Only with code "duplicate_video": the existing public recipe for that video. */
  existingPublicId: z.string().nullable().optional(),
});
export type CloudError = z.infer<typeof CloudError>;
