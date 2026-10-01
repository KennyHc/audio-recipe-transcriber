// In-page serial job queue for the browser backend. Mirrors
// server/src/pipeline/run.ts's state machine (queued -> transcribing ->
// extracting -> verifying -> done/error) but runs entirely in the tab:
// transcription and extraction/verification both happen one job at a time,
// since Whisper inference is CPU/GPU-heavy and we only have one worker loaded.

import type { JobStatus, Recipe, Transcript, VersionSource } from "@recipe/shared";
import type { JobProgress } from "../types";
import * as db from "./db";
import { extractRecipe, ExtractionError, verifyRecipe, VerificationError } from "./claudeProvider";
import { transcribeAudio } from "./transcribe";
import { reloadSettings } from "./settings";
import { isModelCached } from "./modelCatalog";
import { ensureModelDownloaded } from "./modelDownloader";
import { describeTranscriptionError } from "./downloadErrors";
import { formatProcessingSummary, startHiddenTracking } from "@/lib/processingHealth";
import type { WorkerProgress } from "./whisper.worker";

let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const next = queue.then(task, task);
  // Swallow errors here so one failed task doesn't wedge the queue for the
  // next one; the task itself is responsible for recording job.error.
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

const runningJobIds = new Set<string>();
const progressByJob = new Map<string, JobProgress>();
// Jobs paused waiting for the visitor to confirm the speech-model download (see
// startPipeline/resumeAfterModelConsent below and ModelDownloadDialog.tsx). Not in
// runningJobIds — no work is happening while paused here.
const awaitingConsentJobIds = new Set<string>();

export function isJobRunning(jobId: string): boolean {
  return runningJobIds.has(jobId);
}

export function isAwaitingModelConsent(jobId: string): boolean {
  return awaitingConsentJobIds.has(jobId);
}

export function getProgress(jobId: string): JobProgress | null {
  return progressByJob.get(jobId) ?? null;
}

function setProgress(jobId: string, progress: JobProgress | null): void {
  if (progress === null) {
    progressByJob.delete(jobId);
  } else {
    progressByJob.set(jobId, progress);
  }
}

async function setStatus(jobId: string, status: JobStatus): Promise<void> {
  await db.updateJob(jobId, { status });
}

async function setError(jobId: string, message: string): Promise<void> {
  await db.updateJob(jobId, { status: "error", error: message });
}

const STAGE_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  transcribing: "Transcribing",
  extracting: "Extracting recipe",
  verifying: "Checking recipe",
  done: "Done",
  error: "Error",
};

/**
 * Runs extract -> verify against the job's saved transcript and stores the
 * result as a new version. Extraction failure propagates (fails the job);
 * verification failure does not — it's downgraded to a single "other"
 * warning on the saved recipe (matches server/src/pipeline/run.ts).
 */
async function extractVerifyAndSave(jobId: string, source: VersionSource): Promise<void> {
  const transcript = await db.getTranscript(jobId);
  if (!transcript) {
    throw new Error(`Job ${jobId} has no transcript to extract from`);
  }

  // Pick up any settings changes made in this tab (e.g. the Settings page)
  // since the runner started, without requiring a page reload.
  const settings = reloadSettings();

  await setStatus(jobId, "extracting");
  setProgress(jobId, { label: STAGE_LABEL.extracting, fraction: null });
  const extracted = await extractRecipe(transcript, settings);

  await setStatus(jobId, "verifying");
  setProgress(jobId, { label: STAGE_LABEL.verifying, fraction: null });
  let warnings: Recipe["warnings"];
  try {
    warnings = await verifyRecipe(transcript, extracted, settings);
  } catch (err) {
    const message = err instanceof VerificationError ? err.message : err instanceof Error ? err.message : String(err);
    warnings = [
      {
        kind: "other",
        message: `Verification could not run: ${message}`,
        target: null,
        suggestion: null,
      },
    ];
  }

  const recipe: Recipe = { ...extracted, warnings };
  await db.saveVersion(jobId, recipe, source);
  await db.updateJob(jobId, { status: "done", error: null, title: recipe.title });
}

async function transcribeAndSave(jobId: string): Promise<void> {
  const audio = await db.getAudio(jobId);
  if (!audio) {
    throw new Error(`Job ${jobId} has no stored audio to transcribe`);
  }

  const settings = reloadSettings();

  // Timing + tab-visibility instrumentation, logged once transcription finishes, so a slow
  // connection (long download stage) can be told apart from background-tab throttling
  // (nonzero hidden seconds) later — see lib/processingHealth.ts.
  const stopHiddenTracking = startHiddenTracking();
  let downloadStartMs: number | null = null;
  let downloadEndMs: number | null = null;
  let transcribeStartMs: number | null = null;

  try {
    // Pre-fill transformers.js's own Cache Storage via a resumable, chunked downloader
    // BEFORE the worker loads the pipeline, so the worker (transcribeAudio below) only ever
    // reads the model from cache and never performs the download itself — that's what makes
    // this safe against a mid-download interruption (reload, sleep, Wi-Fi drop): transformers.js
    // itself only caches a file once fully downloaded (see modelCatalog.ts's doc comment), but
    // modelDownloader.ts caches progress at 16 MB chunk granularity in its own IndexedDB store.
    await ensureModelDownloaded(settings.whisperModel, settings.whisperDtype, {
      onProgress: (p) => {
        const now = Date.now();
        downloadStartMs ??= now;
        downloadEndMs = now;
        setProgress(jobId, { label: p.label, fraction: p.fraction });
      },
    });
  } catch (err) {
    stopHiddenTracking();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(describeTranscriptionError(message));
  }

  const onProgress = (p: WorkerProgress) => {
    const now = Date.now();
    if (p.stage === "download") {
      downloadStartMs ??= now;
      downloadEndMs = now;
    } else if (p.stage === "transcribe") {
      transcribeStartMs ??= now;
    }
    setProgress(jobId, { label: p.label, fraction: p.fraction });
  };

  let transcript: Transcript | undefined;
  try {
    transcript = await transcribeAudio(audio.blob, settings.whisperModel, settings.whisperDtype, onProgress);
  } finally {
    const transcribeEndMs = Date.now();
    const downloadMs = downloadStartMs !== null ? (downloadEndMs ?? downloadStartMs) - downloadStartMs : null;
    const transcribeMs = transcribeStartMs !== null ? transcribeEndMs - transcribeStartMs : null;
    const audioSeconds = transcript?.segments.length ? transcript.segments[transcript.segments.length - 1]!.end : null;
    const hiddenSeconds = stopHiddenTracking();
    // eslint-disable-next-line no-console
    console.log(formatProcessingSummary({ downloadMs, transcribeMs, audioSeconds, hiddenSeconds }));
  }

  await db.saveTranscript(jobId, transcript!);
}

// Callers mark the job running (and "queued") BEFORE enqueueing, so callers
// polling job state already see a non-terminal status — otherwise the UI's
// poll loop would see a stale "done"/"error" and stop.
async function markQueued(jobId: string): Promise<void> {
  runningJobIds.add(jobId);
  setProgress(jobId, { label: STAGE_LABEL.queued, fraction: null });
  await db.updateJob(jobId, { status: "queued", error: null });
}

async function guarded(jobId: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setError(jobId, message).catch(() => undefined);
  } finally {
    runningJobIds.delete(jobId);
    setProgress(jobId, null);
  }
}

/**
 * Queues the full pipeline (transcribe -> extract -> verify) for a job.
 * Resolves once the job is marked queued, not when the pipeline finishes.
 */
export async function runPipeline(jobId: string): Promise<void> {
  await markQueued(jobId);
  void enqueue(() =>
    guarded(jobId, async () => {
      await setStatus(jobId, "transcribing");
      setProgress(jobId, { label: STAGE_LABEL.transcribing, fraction: null });
      await transcribeAndSave(jobId);
      await extractVerifyAndSave(jobId, "extracted");
    }),
  );
}

/** Queues extract+verify from the job's saved transcript. Resolves once queued.
 * Only valid when the job is not currently running and a transcript exists
 * (callers should check both — see index.ts's reextract()). */
export async function runReextract(jobId: string): Promise<void> {
  await markQueued(jobId);
  void enqueue(() => guarded(jobId, () => extractVerifyAndSave(jobId, "reextracted")));
}

/** Re-runs the full pipeline from stored audio. Only valid from an error
 * state (callers should check — see index.ts's retry()). Goes through the same
 * model-consent gate as a fresh upload (startPipeline) rather than calling runPipeline
 * directly: an error retried here may be exactly "the model download was interrupted",
 * in which case the model is still not fully cached and the dialog should show again. */
export async function runRetry(jobId: string): Promise<void> {
  await startPipeline(jobId);
}

async function pauseForModelConsent(jobId: string): Promise<void> {
  awaitingConsentJobIds.add(jobId);
  await db.updateJob(jobId, { status: "queued", error: null });
  setProgress(jobId, {
    label: "Waiting for speech model — press Download to continue.",
    fraction: null,
    awaitingModelConsent: true,
  });
}

/**
 * Entry point for starting a job's pipeline (a fresh upload, or a retry after an error):
 * starts immediately if the configured speech model is already downloaded in this browser,
 * otherwise pauses the job (see pauseForModelConsent) until resumeAfterModelConsent() is
 * called — which happens once the visitor confirms the download in ModelDownloadDialog, or
 * never, if they press Cancel (the job then just sits paused, not errored).
 */
export async function startPipeline(jobId: string): Promise<void> {
  const settings = reloadSettings();
  const cached = await isModelCached(settings.whisperModel, settings.whisperDtype);
  if (cached) {
    await runPipeline(jobId);
  } else {
    await pauseForModelConsent(jobId);
  }
}

/** Resumes a job paused by pauseForModelConsent, once the visitor has confirmed the
 * download (possibly after changing which model to use — the caller saves that setting
 * before calling this). A no-op if the job is already running (e.g. a double click). */
export async function resumeAfterConsent(jobId: string): Promise<void> {
  awaitingConsentJobIds.delete(jobId);
  if (runningJobIds.has(jobId)) return;
  await runPipeline(jobId);
}

/**
 * On load, any job left in a non-terminal status (from a previous page
 * session that was closed mid-pipeline) can never resume — mark it as an
 * error so the UI doesn't show it stuck "transcribing" forever.
 */
export async function recoverInterruptedJobs(): Promise<void> {
  const jobs = await db.listJobs();
  const TERMINAL: JobStatus[] = ["done", "error"];
  for (const job of jobs) {
    if (!TERMINAL.includes(job.status)) {
      await setError(job.id, "Interrupted — the tab was closed while processing. Press Retry.").catch(() => undefined);
    }
  }
}

export { ExtractionError, VerificationError };
