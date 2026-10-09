// Cloud mode: pure helpers between the account's Firestore shapes (shared/cloud.ts) and the
// app's Job/Backend shapes. No Firebase imports — unit-tested directly.

import {
  MAX_IMPORT_JOBS,
  type BackupJob,
  type CloudRecipe,
  type ImportRequest,
  type Job,
  type QuotaResponse,
  type Recipe,
  type RecipeDoc,
  type Usage,
  type VersionedRecipe,
} from "@recipe/shared";

/** A recipe in the account is always a finished job. */
export function recipeToJob(recipe: CloudRecipe): Job {
  return {
    id: recipe.id,
    fileName: recipe.fileName,
    status: "done",
    error: null,
    title: recipe.title,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };
}

/**
 * The library list: this device's unfinished uploads (transcribing, or failed before the
 * recipe was saved) first, newest first, then the account's recipes in their own order
 * (updatedAt desc, as queried). A local job whose id is already in the account is dropped —
 * the account copy wins.
 */
export function mergeJobs(cloud: CloudRecipe[], localPending: Job[]): Job[] {
  const cloudIds = new Set(cloud.map((r) => r.id));
  const pending = localPending
    .filter((j) => !cloudIds.has(j.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [...pending, ...cloud.map(recipeToJob)];
}

/** The fields of recipes/{id} a client version write may touch (firestore.rules: hasOnly). */
export type ClientRecipeUpdate = Pick<RecipeDoc, "currentVersion" | "latest" | "title" | "updatedAt">;

/**
 * The two writes that save an edit or a rollback, which must land in ONE batch/transaction
 * (firestore.rules checks each against the other with getAfter):
 *   recipes/{id}/versions/{n+1} = { meta: { version, source, createdAt, note }, recipe }
 *   recipes/{id} ← { currentVersion: n+1, latest: recipe, title: recipe.title, updatedAt }
 */
export function buildClientVersionWrite(
  currentVersion: number,
  recipe: Recipe,
  source: "edited" | "rollback",
  note: string | null,
  now: Date = new Date(),
): { versionId: string; versioned: VersionedRecipe; recipeUpdate: ClientRecipeUpdate } {
  const version = currentVersion + 1;
  const createdAt = now.toISOString();
  return {
    versionId: String(version),
    versioned: { meta: { version, source, createdAt, note }, recipe },
    recipeUpdate: { currentVersion: version, latest: recipe, title: recipe.title, updatedAt: createdAt },
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be ≥ 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * POST /import bodies for a set of backup jobs: audio stripped (it never leaves the device),
 * jobs without any version left out (nothing to import), at most MAX_IMPORT_JOBS per request.
 */
export function buildImportRequests(jobs: BackupJob[]): { requests: ImportRequest[]; withoutVersions: string[] } {
  const importable = jobs.filter((j) => j.versions.length > 0).map((j) => ({ ...j, audio: null }));
  const withoutVersions = jobs.filter((j) => j.versions.length === 0).map((j) => j.job.id);
  return { requests: chunk(importable, MAX_IMPORT_JOBS).map((batch) => ({ jobs: batch })), withoutVersions };
}

/** GET /me's monthly usage in the shape the Library's quota line already understands. */
export function usageToQuota(usage: Usage, now: Date = new Date()): QuotaResponse {
  const resetsInSeconds = Math.max(0, Math.round((Date.parse(usage.resetsAt) - now.getTime()) / 1000));
  return { limit: usage.limit, remaining: Math.max(0, usage.remaining), resetsInSeconds };
}
