// Cloud mode's Backend: the account's library (Firestore + the API) merged with this device's
// unfinished uploads (IndexedDB + the in-browser Whisper runner, shared with browser/hosted).
//
//   upload  → local job + local audio → Whisper (browser/runner.ts) → POST /recipes (./finish.ts)
//             → recipe in Firestore; local job removed, audio kept under the same id
//   read    → Firestore (rules-checked): recipes, versions, transcript
//   edit    → one transaction: versions/{n+1} + the recipe's denormalized fields (./store.ts)
//   re-extract → POST /recipes/:id/reextract (awaited, so a failure leaves the recipe visible)
//
// Firebase is injected (session/store/api), so this file is tested with fakes.

import {
  Recipe,
  Transcript as TranscriptSchema,
  type CloudRecipe,
  type Job,
  type MeResponse,
  type Recipe as RecipeType,
  type RecipeVersionMeta,
  type Transcript,
  type Usage,
  type VersionedRecipe,
} from "@recipe/shared";
import { AudioNotOnDeviceError, type Backend, type JobProgress } from "../types";
import * as db from "../browser/db";
import * as runner from "../browser/runner";
import { backupBlob, localAudioForBackup, parseBackupFile, saveBackupAudio } from "../browser/backup";
import type { ApiClient } from "./api";
import type { RecipeStore } from "./store";
import { buildImportRequests, mergeJobs, recipeToJob, usageToQuota } from "./mapping";
import { createCloudFinish } from "./finish";
import { forgetLocalJob, localJobOwner, markLocalJob, setLocalJobSourceUrl } from "./localJobs";

export interface CloudSession {
  /** The signed-in uid; throws "Sign in to continue." when signed out (waits for session restore). */
  requireUid(): Promise<string>;
  /** Synchronous view: null when signed out or still restoring. */
  currentUid(): string | null;
}

/** Shared between the backend and the account menu so usage shown is the latest we know. */
export interface UsageCache {
  get(): MeResponse | null;
  setUsage(usage: Usage): void;
  set(me: MeResponse): void;
}

export interface CloudBackendDeps {
  session: CloudSession;
  store: RecipeStore;
  api: ApiClient;
  usage: UsageCache;
  /** The browser backend, for upload/progress/model consent (same IndexedDB + runner). */
  local: Pick<Backend, "uploadAudio" | "getProgress" | "resumeAfterModelConsent">;
}

/** A local job is one of this user's in-flight uploads (vs. the old local library). */
async function ownLocalJob(id: string, uid: string): Promise<Job | null> {
  const job = await db.getJob(id);
  if (!job || localJobOwner(id) !== uid) return null;
  return job;
}

export function createCloudBackend(deps: CloudBackendDeps): Backend {
  const { session, store, api, usage, local } = deps;
  const audioUrls = new Map<string, string>();
  const reextracting = new Set<string>();

  runner.setFinishStep(
    createCloudFinish({
      api,
      requireUid: () => session.requireUid(),
      onRecipeSaved: (uid, recipe) => store.noteRecipe(uid, recipe),
      onUsage: (u) => usage.setUsage(u),
    }),
  );

  async function cloudRecipe(id: string): Promise<CloudRecipe> {
    await session.requireUid();
    return store.getRecipe(id);
  }

  return {
    kind: "browser",

    async listJobs(): Promise<Job[]> {
      const uid = await session.requireUid();
      const [cloud, localJobs] = await Promise.all([store.listRecipes(uid), db.listJobs()]);
      const pending = localJobs.filter((j) => j.status !== "done" && localJobOwner(j.id) === uid);
      return mergeJobs(cloud, pending);
    },

    async getJob(id: string): Promise<Job> {
      const uid = await session.requireUid();
      const localJob = await ownLocalJob(id, uid);
      if (localJob) return localJob;
      const job = recipeToJob(await store.getRecipe(id));
      return reextracting.has(id) ? { ...job, status: "extracting" } : job;
    },

    async getTranscript(id: string): Promise<Transcript> {
      const uid = await session.requireUid();
      if (await ownLocalJob(id, uid)) {
        const transcript = await db.getTranscript(id);
        if (!transcript) throw new Error("Transcript not available yet.");
        return transcript;
      }
      const transcript = await store.getTranscript(id);
      if (!transcript) throw new Error("Transcript not available.");
      return transcript;
    },

    async getRecipe(id: string): Promise<VersionedRecipe> {
      const uid = await session.requireUid();
      if (await ownLocalJob(id, uid)) throw new Error("Recipe not available yet.");
      const recipe = await store.getRecipe(id);
      return store.getVersion(id, recipe.currentVersion);
    },

    async putRecipe(id: string, recipe: RecipeType): Promise<VersionedRecipe> {
      await session.requireUid();
      const parsed = Recipe.safeParse(recipe);
      if (!parsed.success) throw new Error(`Invalid recipe: ${parsed.error.message}`);
      return store.saveClientVersion(id, parsed.data, "edited", null);
    },

    async listVersions(id: string): Promise<RecipeVersionMeta[]> {
      await session.requireUid();
      const versions = await store.listVersions(id);
      return versions.map((v) => v.meta).sort((a, b) => b.version - a.version);
    },

    async getVersion(id: string, version: number): Promise<VersionedRecipe> {
      await session.requireUid();
      return store.getVersion(id, version);
    },

    async rollback(id: string, version: number): Promise<VersionedRecipe> {
      await session.requireUid();
      const target = await store.getVersion(id, version);
      return store.saveClientVersion(id, target.recipe, "rollback", `Restored from v${version}`);
    },

    async reextract(id: string): Promise<Job> {
      const uid = await session.requireUid();
      const localJob = await ownLocalJob(id, uid);
      if (localJob) {
        // Not in the account yet (the first POST failed): send the saved transcript again.
        if (runner.isJobRunning(id)) throw new Error("Job is already running.");
        if (!(await db.getTranscript(id))) throw new Error("No transcript available to re-extract from.");
        await runner.runReextract(id);
        return (await db.getJob(id)) ?? localJob;
      }
      if (reextracting.has(id)) throw new Error("Already making a new version.");
      await cloudRecipe(id);
      reextracting.add(id);
      try {
        const res = await api.reextract(id);
        store.noteRecipe(uid, res.recipe);
        usage.setUsage(res.usage);
        return recipeToJob(res.recipe);
      } finally {
        reextracting.delete(id);
      }
    },

    async retry(id: string): Promise<Job> {
      const uid = await session.requireUid();
      const job = await ownLocalJob(id, uid);
      if (!job) throw new Error("Nothing to retry — this recipe is already saved.");
      if (runner.isJobRunning(id)) throw new Error("Job is already running.");
      if (job.status !== "error") throw new Error("Job is not in an error state.");
      if (await db.getTranscript(id)) {
        // Transcribed already; only making the recipe failed (quota, budget, network…).
        await runner.runReextract(id);
      } else {
        if (!(await db.getAudio(id))) {
          throw new Error("Original audio file is missing; cannot retry. Re-upload the audio instead.");
        }
        await runner.runRetry(id);
      }
      return (await db.getJob(id)) ?? job;
    },

    async resumeAfterModelConsent(id: string): Promise<Job> {
      await session.requireUid();
      return local.resumeAfterModelConsent(id);
    },

    async deleteJob(id: string): Promise<void> {
      await session.requireUid();
      if (runner.isJobRunning(id)) throw new Error("This recording is still being processed — wait for it to finish.");
      await store.deleteRecipe(id);
      const cached = audioUrls.get(id);
      if (cached) {
        URL.revokeObjectURL(cached);
        audioUrls.delete(id);
      }
      await db.deleteJobRecord(id);
      forgetLocalJob(id);
    },

    async getAudioUrl(id: string): Promise<string> {
      const cached = audioUrls.get(id);
      if (cached) return cached;
      const audio = await db.getAudio(id);
      if (!audio) throw new AudioNotOnDeviceError();
      const url = URL.createObjectURL(audio.blob);
      audioUrls.set(id, url);
      return url;
    },

    uploadAudio(file, onProgress, options) {
      const uid = session.currentUid();
      if (!uid) {
        return { promise: Promise.reject(new Error("Sign in to add a recipe.")), cancel: () => undefined };
      }
      const upload = local.uploadAudio(file, onProgress);
      return {
        promise: upload.promise.then((job) => {
          markLocalJob(job.id, uid);
          if (options?.sourceUrl) setLocalJobSourceUrl(job.id, options.sourceUrl);
          return job;
        }),
        cancel: upload.cancel,
      };
    },

    getProgress(id: string): JobProgress | null {
      if (reextracting.has(id)) return { label: "Making a new version", fraction: null };
      return local.getProgress(id);
    },

    async putTranscript(id: string, transcript: Transcript): Promise<Transcript> {
      const uid = await session.requireUid();
      const parsed = TranscriptSchema.parse(transcript);
      if (await ownLocalJob(id, uid)) {
        if (runner.isJobRunning(id)) throw new Error("Job is already running.");
        await db.saveTranscript(id, parsed);
        return parsed;
      }
      await store.putTranscript(id, parsed);
      return parsed;
    },

    canBackup: true,

    async exportLibrary({ includeAudio }): Promise<Blob> {
      const uid = await session.requireUid();
      const recipes = await store.listRecipes(uid);
      const jobs = [];
      for (const recipe of recipes) {
        const [versions, transcript] = await Promise.all([
          store.listVersions(recipe.id),
          store.getTranscript(recipe.id).catch(() => null),
        ]);
        const audio = includeAudio ? await localAudioForBackup(recipe.id) : null;
        jobs.push({ job: recipeToJob(recipe), transcript, versions, audio });
      }
      return backupBlob(jobs);
    },

    async importLibrary(file: File): Promise<{ imported: number; skipped: number }> {
      await session.requireUid();
      const backup = await parseBackupFile(file);
      // Audio never goes to the account; keep it on this device under the recipe's id.
      for (const job of backup.jobs) {
        if (job.audio && !(await db.getAudio(job.job.id))) {
          await saveBackupAudio(job.job.id, job.audio);
        }
      }
      const { requests, withoutVersions } = buildImportRequests(backup.jobs);
      let imported = 0;
      let skipped = withoutVersions.length;
      for (const body of requests) {
        const res = await api.importJobs(body);
        imported += res.imported.length;
        skipped += res.skipped.length;
      }
      return { imported, skipped };
    },

    async getQuota() {
      try {
        const me = await api.getMe();
        usage.set(me);
        return usageToQuota(me.usage);
      } catch {
        return null;
      }
    },
  };
}
