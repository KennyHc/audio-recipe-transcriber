/**
 * POST /import: moves a local (IndexedDB) library into the account. No Claude, no quota —
 * these recipes were already made (and paid for) on the anonymous/BYOK paths.
 */
import {
  type ImportRequest,
  type ImportResponse,
  type RecipeDoc,
  type TranscriptDoc,
  type VersionedRecipe,
} from "@recipe/shared";
import type { Firestore } from "firebase-admin/firestore";
import { isAlreadyExists, recipeRef, transcriptRef, versionRef } from "./recipes";
import { isTranscriptTooLarge, RECIPE_ID_PATTERN } from "./validation";

type ImportJob = ImportRequest["jobs"][number];

/** A batch holds 500 writes: recipe + transcript + versions must fit in one, atomically. */
const MAX_VERSIONS_PER_RECIPE = 498;

export async function importJobs(db: Firestore, uid: string, request: ImportRequest): Promise<ImportResponse> {
  const imported: string[] = [];
  const skipped: string[] = [];

  // Sequential on purpose: ≤ MAX_IMPORT_JOBS small batches, and it keeps a duplicated id
  // within one request deterministic (first wins, the second fails its create()).
  for (const job of request.jobs) {
    const id = job.job.id;
    const versions = usableVersions(job);
    if (!RECIPE_ID_PATTERN.test(id) || !versions) {
      skipped.push(id);
      continue;
    }
    // Any owner: ids are global, and we never overwrite or merge into an existing recipe.
    if ((await recipeRef(db, id).get()).exists) {
      skipped.push(id);
      continue;
    }

    const last = versions[versions.length - 1]!;
    const doc: RecipeDoc = {
      ownerId: uid,
      visibility: "private",
      title: last.recipe.title,
      fileName: job.job.fileName,
      createdAt: job.job.createdAt,
      updatedAt: job.job.updatedAt,
      currentVersion: last.meta.version,
      latest: last.recipe,
    };

    const batch = db.batch();
    // create(): if the id appeared since the check above, the whole batch fails → skipped.
    batch.create(recipeRef(db, id), doc);
    for (const v of versions) batch.create(versionRef(db, id, v.meta.version), v);
    // Oversized transcripts are dropped (the recipe still imports; re-extract will then
    // answer 409 until the user saves a shorter transcript).
    if (job.transcript && !isTranscriptTooLarge(job.transcript)) {
      const transcriptDoc: TranscriptDoc = { transcript: job.transcript, updatedAt: job.job.updatedAt };
      batch.create(transcriptRef(db, id), transcriptDoc);
    }

    try {
      await batch.commit();
      imported.push(id);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      skipped.push(id);
    }
  }

  return { imported, skipped };
}

/**
 * The job's versions in ascending order, or null if it can't be imported faithfully: no
 * versions, too many for one batch, or version numbers that aren't distinct positive
 * integers (they become doc ids, and the rules expect versions/{n}.meta.version == n).
 */
function usableVersions(job: ImportJob): VersionedRecipe[] | null {
  if (job.versions.length === 0 || job.versions.length > MAX_VERSIONS_PER_RECIPE) return null;
  const sorted = [...job.versions].sort((a, b) => a.meta.version - b.meta.version);
  const numbers = sorted.map((v) => v.meta.version);
  if (!numbers.every((n) => Number.isInteger(n) && n > 0)) return null;
  if (new Set(numbers).size !== numbers.length) return null;
  return sorted;
}
