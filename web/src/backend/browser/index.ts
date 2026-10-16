// Wires up the browser backend: IndexedDB storage, in-page pipeline runner,
// and the Web Audio + transformers.js + Claude-via-API-key stages. Mirrors
// server/src/app.ts's route semantics (statuses, versions, rollback note,
// reextract/retry rules, 409-equivalent errors) as plain thrown Errors,
// since there's no HTTP layer here — the UI calls these methods directly.

import { Recipe, Transcript as TranscriptSchema, type Job, type Recipe as RecipeType, type RecipeVersionMeta, type Transcript, type VersionedRecipe } from "@recipe/shared";
import type { Backend, CaptionsInput, CaptionsOptions, JobProgress } from "../types";
import { captionsJobFileName, parseCaptionsOrThrow } from "@/lib/captions";
import * as db from "./db";
import * as runner from "./runner";
import { exportLibrary, importLibrary } from "./backup";
import { fetchQuota } from "./quota";
import { IS_HOSTED } from "@/lib/mode";

const ALLOWED_EXTENSIONS = new Set(["mp3", "m4a", "wav", "webm", "ogg", "mp4", "aac", "flac"]);
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

function extOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

async function requireJob(id: string): Promise<Job> {
  const job = await db.getJob(id);
  if (!job) throw new Error("Job not found.");
  return job;
}

function newJobId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (older browsers / some test runners).
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * "Paste captions instead": a local job WITHOUT audio, whose parsed transcript is saved up front
 * and goes straight to the finish step (extract + verify here; POST /recipes in cloud mode).
 * Exported so cloud mode's tests can use the real thing without a whole browser backend.
 */
export async function createCaptionsJob(input: CaptionsInput, options?: CaptionsOptions): Promise<Job> {
  const { transcript } = parseCaptionsOrThrow(input.text);
  const id = newJobId();
  const now = new Date().toISOString();
  await db.createJob({
    id,
    fileName: captionsJobFileName(input.fileName),
    status: "queued",
    error: null,
    title: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.saveTranscript(id, transcript);
  options?.onJobCreated?.(id);
  await runner.runFromTranscript(id);
  return requireJob(id);
}

export function createBrowserBackend(): Backend {
  // Object URLs for the current page session, keyed by jobId, revoked on delete.
  const audioUrls = new Map<string, string>();

  // Mark any jobs orphaned by a previous session (tab closed mid-pipeline) as
  // errored — fire-and-forget; the UI's own poll will pick up the result.
  void runner.recoverInterruptedJobs();

  return {
    kind: "browser",

    async listJobs(): Promise<Job[]> {
      return db.listJobs();
    },

    async getJob(id: string): Promise<Job> {
      return requireJob(id);
    },

    async getTranscript(id: string): Promise<Transcript> {
      await requireJob(id);
      const transcript = await db.getTranscript(id);
      if (!transcript) throw new Error("Transcript not available yet.");
      return transcript;
    },

    async getRecipe(id: string): Promise<VersionedRecipe> {
      await requireJob(id);
      const versioned = await db.getLatestVersion(id);
      if (!versioned) throw new Error("Recipe not available yet.");
      return versioned;
    },

    async putRecipe(id: string, recipe: RecipeType): Promise<VersionedRecipe> {
      const job = await requireJob(id);
      const parsed = Recipe.safeParse(recipe);
      if (!parsed.success) {
        throw new Error(`Invalid recipe: ${parsed.error.message}`);
      }
      const versioned = await db.saveVersion(id, parsed.data, "edited");
      await db.saveJob({ ...job, title: parsed.data.title, updatedAt: new Date().toISOString() });
      return versioned;
    },

    async listVersions(id: string): Promise<RecipeVersionMeta[]> {
      await requireJob(id);
      return db.listVersions(id);
    },

    async getVersion(id: string, version: number): Promise<VersionedRecipe> {
      await requireJob(id);
      const versioned = await db.getVersion(id, version);
      if (!versioned) throw new Error(`Version ${version} not found.`);
      return versioned;
    },

    async rollback(id: string, version: number): Promise<VersionedRecipe> {
      const job = await requireJob(id);
      const target = await db.getVersion(id, version);
      if (!target) throw new Error(`Version ${version} not found.`);
      const versioned = await db.saveVersion(id, target.recipe, "rollback", `Restored from v${version}`);
      await db.saveJob({ ...job, title: target.recipe.title, updatedAt: new Date().toISOString() });
      return versioned;
    },

    async reextract(id: string): Promise<Job> {
      await requireJob(id);
      if (runner.isJobRunning(id)) {
        throw new Error("Job is already running.");
      }
      const transcript = await db.getTranscript(id);
      if (!transcript) {
        throw new Error("No transcript available to re-extract from.");
      }
      await runner.runReextract(id);
      return requireJob(id);
    },

    async retry(id: string): Promise<Job> {
      const job = await requireJob(id);
      if (runner.isJobRunning(id)) {
        throw new Error("Job is already running.");
      }
      if (job.status !== "error") {
        throw new Error("Job is not in an error state.");
      }
      const audio = await db.getAudio(id);
      if (!audio) {
        // A captions job has no audio: there's nothing to re-transcribe, so make the recipe again
        // from its saved transcript.
        if (await db.getTranscript(id)) {
          if ((await db.listVersions(id)).length === 0) await runner.runFromTranscript(id);
          else await runner.runReextract(id);
          return requireJob(id);
        }
        throw new Error("Original audio file is missing; cannot retry. Re-upload the audio instead.");
      }
      await runner.runRetry(id);
      return requireJob(id);
    },

    async resumeAfterModelConsent(id: string): Promise<Job> {
      await requireJob(id);
      await runner.resumeAfterConsent(id);
      return requireJob(id);
    },

    async deleteJob(id: string): Promise<void> {
      const cached = audioUrls.get(id);
      if (cached) {
        URL.revokeObjectURL(cached);
        audioUrls.delete(id);
      }
      await db.deleteJobRecord(id);
    },

    async getAudioUrl(id: string): Promise<string> {
      const cached = audioUrls.get(id);
      if (cached) return cached;
      const audio = await db.getAudio(id);
      if (!audio) throw new Error("Audio file not found.");
      const url = URL.createObjectURL(audio.blob);
      audioUrls.set(id, url);
      return url;
    },

    uploadAudio(file: File, onProgress: (fraction: number) => void) {
      let cancelled = false;
      let reader: FileReader | null = null;

      const promise = (async (): Promise<Job> => {
        const ext = extOf(file.name);
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          throw new Error(`Unsupported file extension ".${ext || "?"}". Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}.`);
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          throw new Error("File too large (max 200 MB).");
        }

        onProgress(0);
        const blob = await new Promise<Blob>((resolve, reject) => {
          const fr = new FileReader();
          reader = fr;
          fr.onprogress = (ev) => {
            if (cancelled) return;
            if (ev.lengthComputable && ev.total > 0) {
              onProgress(Math.min(0.9, ev.loaded / ev.total));
            }
          };
          fr.onerror = () => reject(fr.error ?? new Error("Could not read the audio file."));
          fr.onabort = () => reject(new Error("Upload cancelled."));
          fr.onload = () => {
            if (cancelled) return;
            resolve(new Blob([fr.result as ArrayBuffer], { type: file.type }));
          };
          fr.readAsArrayBuffer(file);
        });
        if (cancelled) throw new Error("Upload cancelled.");

        const id = newJobId();
        const now = new Date().toISOString();
        const job: Job = {
          id,
          fileName: file.name,
          status: "queued",
          error: null,
          title: null,
          createdAt: now,
          updatedAt: now,
        };

        await db.createJob(job);
        await db.saveAudio(id, file.name, blob);
        onProgress(1);

        await runner.startPipeline(id);
        return requireJob(id);
      })();

      return {
        promise,
        cancel: () => {
          cancelled = true;
          reader?.abort();
        },
      };
    },

    canUseCaptions: true,

    createFromCaptions: createCaptionsJob,

    getProgress(id: string): JobProgress | null {
      return runner.getProgress(id);
    },

    async putTranscript(id: string, transcript: Transcript): Promise<Transcript> {
      await requireJob(id);
      if (runner.isJobRunning(id)) throw new Error("Job is already running.");
      if (!(await db.getTranscript(id))) throw new Error("This job has no transcript yet.");
      const parsed = TranscriptSchema.parse(transcript);
      await db.saveTranscript(id, parsed);
      return parsed;
    },

    canBackup: true,
    exportLibrary: (options) => exportLibrary(options),
    importLibrary: (file) => importLibrary(file),

    getQuota: () => (IS_HOSTED ? fetchQuota() : Promise.resolve(null)),
  };
}
