import { api } from "@/lib/api";
import type { Backend, JobProgress } from "./types";

/**
 * Wraps the existing HTTP API (`lib/api.ts`) as a `Backend`. `lib/api.ts` stays the plain
 * HTTP layer; this file adapts it to the shape the UI now talks to.
 */
export function createServerBackend(): Backend {
  return {
    kind: "server",

    listJobs: () => api.listJobs(),
    getJob: (id) => api.getJob(id),
    getTranscript: (id) => api.getTranscript(id),
    getRecipe: (id) => api.getRecipe(id),
    putRecipe: (id, recipe) => api.putRecipe(id, recipe),
    listVersions: (id) => api.listVersions(id),
    getVersion: (id, version) => api.getVersion(id, version),
    rollback: (id, version) => api.rollback(id, version),
    reextract: (id) => api.reextract(id),
    retry: (id) => api.retry(id),
    deleteJob: (id) => api.deleteJob(id),

    // The server serves audio directly from a stable URL; nothing to resolve.
    getAudioUrl: (id) => Promise.resolve(api.audioUrl(id)),

    uploadAudio: (file, onProgress) => api.uploadAudio(file, onProgress),

    // The server backend has no fine-grained in-browser stage to report; Job.status +
    // the existing Stepper cover it.
    getProgress: (_id): JobProgress | null => null,

    // No model-download consent gate on the server backend; nothing to resume.
    resumeAfterModelConsent: (id) => api.getJob(id),

    putTranscript: (id, transcript) => api.putTranscript(id, transcript),

    // Local-server data already lives as plain files on disk (data/); no browser backup.
    canBackup: false,
    exportLibrary: () => Promise.reject(new Error("Backups are only available in the browser versions.")),
    importLibrary: () => Promise.reject(new Error("Backups are only available in the browser versions.")),

    // No free-use quota when running your own server.
    getQuota: () => Promise.resolve(null),
  };
}
