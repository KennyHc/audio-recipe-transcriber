// Cloud mode: moving the old local library (recipes made in this browser before accounts
// existed — same IndexedDB database, see ./localJobs.ts) into the signed-in account via
// POST /import. Doesn't count against the monthly limit. On success the local job, transcript
// and version records are removed; the audio stays on this device under the same id.

import type { Job } from "@recipe/shared";
import * as db from "../browser/db";
import { buildBackupJob } from "../browser/backup";
import type { ApiClient } from "./api";
import { buildImportRequests } from "./mapping";
import { localJobOwner } from "./localJobs";

/** Finished recipes in this browser's old local library (not uploads made while signed in). */
export async function listLegacyJobs(): Promise<Job[]> {
  const jobs = await db.listJobs();
  return jobs.filter((j) => j.status === "done" && localJobOwner(j.id) === null);
}

export interface MoveDeps {
  api: Pick<ApiClient, "importJobs">;
  /** True if `id` is a recipe in the signed-in account (false for missing or someone else's). */
  isInAccount(id: string): Promise<boolean>;
}

export async function moveLegacyJobs(deps: MoveDeps): Promise<{ imported: number; skipped: number }> {
  const jobs = await listLegacyJobs();
  const backupJobs = [];
  for (const job of jobs) backupJobs.push(await buildBackupJob(job, { includeAudio: false }));
  const { requests, withoutVersions } = buildImportRequests(backupJobs);

  let imported = 0;
  let skipped = withoutVersions.length;
  for (const body of requests) {
    const res = await deps.api.importJobs(body);
    imported += res.imported.length;
    skipped += res.skipped.length;
    for (const id of res.imported) await db.deleteJobRecord(id, { keepAudio: true });
    // "Skipped" means the id already exists — only drop our copy if it's really in THIS account.
    for (const id of res.skipped) {
      if (await deps.isInAccount(id)) await db.deleteJobRecord(id, { keepAudio: true });
    }
  }
  return { imported, skipped };
}
