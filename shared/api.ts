import { z } from "zod";
import { Recipe } from "./recipe";

// HTTP contract between server/ and web/. All routes are prefixed with /api.
//
//   POST /api/jobs                 multipart form, field "audio"  -> Job (201)
//   GET  /api/jobs                 -> Job[] (newest first)
//   GET  /api/jobs/:id             -> Job
//   GET  /api/jobs/:id/transcript  -> Transcript        (404 until transcribed)
//   PUT  /api/jobs/:id/transcript  body Transcript -> Transcript  replaces the saved transcript
//        with the user's corrected version (409 if the job is running; 404 if there is no
//        transcript yet). Recipe versions are untouched; the client then calls /reextract.
//   GET  /api/jobs/:id/recipe      -> VersionedRecipe   latest version (404 until done)
//   PUT  /api/jobs/:id/recipe      body Recipe -> VersionedRecipe  saves user edits as a NEW version
//   GET  /api/jobs/:id/recipe/versions      -> RecipeVersionMeta[] (newest first)
//   GET  /api/jobs/:id/recipe/versions/:v   -> VersionedRecipe
//   POST /api/jobs/:id/recipe/rollback  body RollbackRequest -> VersionedRecipe
//        copies version v forward as a new latest version (history is never deleted)
//   POST /api/jobs/:id/reextract   -> Job  (re-runs extract+verify on saved transcript;
//                                   result is saved as a new version with source "reextracted")
//   POST /api/jobs/:id/retry       -> Job  (re-runs the FULL pipeline from the saved original
//                                   audio; for jobs that failed before a transcript existed.
//                                   409 if running; 409 if status is not "error")
//   GET  /api/jobs/:id/audio      -> original audio, MUST support HTTP Range (206) for seeking
//   DELETE /api/jobs/:id           -> 204
//
// Errors: non-2xx with body ApiError.
// The web client polls GET /api/jobs/:id every ~1s while status is not terminal.

export const JobStatus = z.enum([
  "queued",
  "transcribing",
  "extracting",
  "verifying",
  "done",
  "error",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const TERMINAL_STATUSES: JobStatus[] = ["done", "error"];

export const Job = z.object({
  id: z.string(),
  fileName: z.string(),
  status: JobStatus,
  error: z.string().nullable(),
  title: z.string().nullable(), // recipe title once extracted
  createdAt: z.string(), // ISO
  updatedAt: z.string(), // ISO
});
export type Job = z.infer<typeof Job>;

// Recipe versions: stored as data/<jobId>/recipes/v<N>.json, N starting at 1.
export const VersionSource = z.enum(["extracted", "edited", "reextracted", "rollback"]);
export type VersionSource = z.infer<typeof VersionSource>;

export const RecipeVersionMeta = z.object({
  version: z.number(),
  source: VersionSource,
  createdAt: z.string(), // ISO
  note: z.string().nullable(), // e.g. "rolled back to v2"
});
export type RecipeVersionMeta = z.infer<typeof RecipeVersionMeta>;

export const VersionedRecipe = z.object({
  meta: RecipeVersionMeta,
  recipe: Recipe,
});
export type VersionedRecipe = z.infer<typeof VersionedRecipe>;

export const RollbackRequest = z.object({ version: z.number() });
export type RollbackRequest = z.infer<typeof RollbackRequest>;

export const ApiError =z.object({ error: z.string() });
export type ApiError = z.infer<typeof ApiError>;
