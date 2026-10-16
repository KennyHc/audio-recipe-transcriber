import type { Job, QuotaResponse, Recipe, RecipeVersionMeta, Transcript, VersionedRecipe } from "@recipe/shared";

// The UI talks to exactly one Backend, chosen at build time (see ./index.ts):
//   "server"  — the local Node server (whisper.cpp + Claude via CLI or API key).
//   "browser" — fully client-side: Whisper runs in the browser (WebGPU/WASM), data lives
//               in IndexedDB, and Claude is called directly with the user's own API key.
//               ("hosted" and "cloud" builds also report "browser": both transcribe in the page;
//               see lib/mode.ts for IS_HOSTED / IS_CLOUD.)
// Both implement the same semantics as shared/api.ts (versions, rollback, retry, ...).

export type BackendKind = "server" | "browser";

/** Fine-grained progress for the current stage, beyond Job.status. */
export interface JobProgress {
  /** Human-readable, e.g. "Downloading speech model (once) — 312 of 640 MB", "Transcribing". */
  label: string;
  /** 0..1 when known; null for indeterminate. */
  fraction: number | null;
  /** Browser backend, while transcribing: e.g. "Keep this tab open — about 4 min left". */
  detail?: string | null;
  /** Browser backend only: true when the job is paused waiting for the visitor to confirm
   * the speech-model download via the consent dialog (see ModelDownloadDialog.tsx and
   * backend/browser/runner.ts's startPipeline/resumeAfterModelConsent). Never set by the
   * server backend, which has no such gate. */
  awaitingModelConsent?: boolean;
}

export interface UploadOptions {
  sourceUrl?: string | null;
}

/** What the visitor pasted (or the caption file they picked) for "Paste captions instead". */
export interface CaptionsInput {
  text: string;
  /** The caption file's name; null/empty for pasted text ("Pasted captions"). */
  fileName?: string | null;
}

export interface CaptionsOptions extends UploadOptions {
  /** Internal (cloud mode): called once the local job exists, before processing starts — so its
   * owner and video link are recorded before the finish step reads them. */
  onJobCreated?: (jobId: string) => void;
}

export interface Backend {
  kind: BackendKind;

  listJobs(): Promise<Job[]>;
  getJob(id: string): Promise<Job>;
  getTranscript(id: string): Promise<Transcript>;
  getRecipe(id: string): Promise<VersionedRecipe>;
  putRecipe(id: string, recipe: Recipe): Promise<VersionedRecipe>;
  listVersions(id: string): Promise<RecipeVersionMeta[]>;
  getVersion(id: string, version: number): Promise<VersionedRecipe>;
  rollback(id: string, version: number): Promise<VersionedRecipe>;
  reextract(id: string): Promise<Job>;
  retry(id: string): Promise<Job>;
  deleteJob(id: string): Promise<void>;

  /** A URL the <audio> element can play (a server URL, or an object URL for a stored Blob). */
  getAudioUrl(id: string): Promise<string>;

  /** Create a job from an audio file. `onProgress` reports upload/storage progress (0..1).
   * `options.sourceUrl` (cloud mode only; ignored elsewhere): the video/page link entered at
   * upload, kept with the local job and sent with POST /recipes. */
  uploadAudio(
    file: File,
    onProgress: (fraction: number) => void,
    options?: UploadOptions,
  ): { promise: Promise<Job>; cancel: () => void };

  /** "Paste captions instead" (browser, hosted and cloud modes; false on the local server). */
  canUseCaptions: boolean;

  /** Create a job from a pasted transcript/captions instead of audio: no speech model, no
   * transcription — the parsed transcript goes straight to making the recipe. Throws a
   * user-facing Error for unusable or too-long text. */
  createFromCaptions(input: CaptionsInput, options?: CaptionsOptions): Promise<Job>;

  /** Current stage detail for a running job, or null (server backend: always null). */
  getProgress(id: string): JobProgress | null;

  /**
   * Resumes a job paused with `getProgress(id).awaitingModelConsent === true` after the
   * visitor confirms the speech-model download in ModelDownloadDialog. A no-op returning the
   * job unchanged on the server backend, which never sets that flag.
   */
  resumeAfterModelConsent(id: string): Promise<Job>;

  /** Replaces the saved transcript with the user's corrected one (then call reextract). */
  putTranscript(id: string, transcript: Transcript): Promise<Transcript>;

  /** Whole-library backup (browser/hosted/cloud modes; `canBackup` tells the UI). In cloud mode
   * export reads the account (Firestore) and import moves the file into the account. */
  canBackup: boolean;
  exportLibrary(options: { includeAudio: boolean }): Promise<Blob>;
  importLibrary(file: File): Promise<{ imported: number; skipped: number }>;

  /** The free-recipe allowance: today's in hosted mode, this month's in cloud mode (mapped from
   * GET /me); null in other modes or if unavailable. */
  getQuota(): Promise<QuotaResponse | null>;

  /** Errors like "no API key" are thrown with this code so the UI can route to Settings. */
}

export class NeedsSetupError extends Error {
  readonly code = "needs_setup";
}

/** Cloud mode: the recipe is in the account, but its audio only exists on the device it was
 * uploaded from (audio never leaves the device). `getAudioUrl` throws this so the UI can hide
 * click-to-hear and say why, instead of showing a player that can't play anything. */
export class AudioNotOnDeviceError extends Error {
  readonly code = "audio_not_on_device";
  constructor(message = "The audio for this recipe is on the device you uploaded it from.") {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Browser-mode settings (stored per device in localStorage, wrapped in try/catch).
// The API key never leaves the device except in requests to api.anthropic.com.
// ---------------------------------------------------------------------------

export interface BrowserSettings {
  apiKey: string | null;
  extractorModel: string; // default "claude-haiku-4-5" (cheapest that scored 100% in evals)
  verifierModel: string; // default "claude-haiku-4-5"
  whisperModel: string; // default "onnx-community/whisper-large-v3-turbo"
  whisperDtype: string; // default "q4"
}

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  apiKey: null,
  extractorModel: "claude-haiku-4-5",
  verifierModel: "claude-haiku-4-5",
  whisperModel: "onnx-community/whisper-large-v3-turbo",
  whisperDtype: "q4",
};
