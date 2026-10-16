// In-page serial job queue for the browser backend. Mirrors
// server/src/pipeline/run.ts's state machine (queued -> transcribing ->
// extracting -> verifying -> done/error) but runs entirely in the tab:
// transcription and extraction/verification both happen one job at a time,
// since Whisper inference is CPU/GPU-heavy and we only have one worker loaded.

import { stripTimestampsIfUntimed, type JobStatus, type Recipe, type Transcript, type VersionSource } from "@recipe/shared";
import type { JobProgress } from "../types";
import * as db from "./db";
import { extractRecipe, ExtractionError, verifyRecipe, VerificationError } from "./claudeProvider";
import { transcribeAudio } from "./transcribe";
import { reloadSettings } from "./settings";
import { isModelCached } from "./modelCatalog";
import { ensureModelDownloaded, InsufficientStorageError } from "./modelDownloader";
import { describeTranscriptionError, isNetworkFailureMessage } from "./downloadErrors";
import { errorCodeOf, errorReporter } from "@/lib/errorReporting";
import { formatProcessingSummary, startHiddenTracking } from "@/lib/processingHealth";
import type { WorkerProgress } from "./whisper.worker";
import type { WindowProgress } from "./transcribe";
import { clearCheckpoint, noteAutoResume, resetAutoResumes } from "./checkpoints";
import { holdScreenWakeLock } from "@/lib/wakeLock";
import { estimateSecondsLeft, formatTimeLeft, priorSecondsPerAudioSecond } from "@/lib/transcriptionEta";
import { readDeviceFacts } from "@/lib/deviceProfile";
import { formatTimestamp } from "@/lib/format";

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

// The stage each running job is in, so a failure can be reported with where it happened.
const stageByJob = new Map<string, JobStatus>();

async function setStatus(jobId: string, status: JobStatus): Promise<void> {
  stageByJob.set(jobId, status);
  await db.updateJob(jobId, { status });
}

function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

/** A 4xx from the Cloud Run API (quota, sign-in, too long…) is an answer for the user, not a bug. */
function isUserFacingApiError(err: unknown): boolean {
  const status = typeof err === "object" && err !== null ? (err as { status?: unknown }).status : undefined;
  return typeof status === "number" && status >= 400 && status < 500;
}

function reportPipelineFailure(jobId: string, err: unknown): void {
  if (errorReporter.wasReported(err) || isAbortError(err) || isUserFacingApiError(err)) return;
  errorReporter.report({ kind: "pipeline", stage: stageByJob.get(jobId) ?? null, code: errorCodeOf(err), error: err });
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
  // Pasted plain-text captions have no timing: drop any "0:00" the extractor copied over.
  const extracted = stripTimestampsIfUntimed(await extractRecipe(transcript, settings), transcript);

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

// ---------------------------------------------------------------------------
// The finish step: what happens after the transcript is saved. Browser/hosted modes run
// extract -> verify -> save a version right here (extractVerifyAndSave). Cloud mode swaps in
// a step that sends the transcript to the API instead (backend/cloud/finish.ts), which saves
// the recipe in the account. Everything around it — the queue, statuses, progress, and the
// error handling in guarded() — is shared.
// ---------------------------------------------------------------------------

export interface FinishContext {
  /** Moves the job to `status` and shows `label` (default: the stage's usual label). */
  setStage(status: JobStatus, label?: string): Promise<void>;
}

/** Runs after transcription ("extracted") and for re-extracts ("reextracted"). Throwing fails the
 * job with the error's message (see guarded()). */
export type FinishStep = (jobId: string, source: "extracted" | "reextracted", ctx: FinishContext) => Promise<void>;

const defaultFinish: FinishStep = (jobId, source) => extractVerifyAndSave(jobId, source);
let finishStep: FinishStep = defaultFinish;

/** Replaces the finish step (cloud mode). `null` restores the default local extract+verify. */
export function setFinishStep(step: FinishStep | null): void {
  finishStep = step ?? defaultFinish;
}

function finish(jobId: string, source: "extracted" | "reextracted"): Promise<void> {
  return finishStep(jobId, source, {
    async setStage(status, label) {
      await setStatus(jobId, status);
      setProgress(jobId, { label: label ?? STAGE_LABEL[status], fraction: null });
    },
  });
}

async function transcribeAndSave(jobId: string, resuming: boolean): Promise<void> {
  const audio = await db.getAudio(jobId);
  if (!audio) {
    throw new Error(`Job ${jobId} has no stored audio to transcribe`);
  }
  // Keep the screen on while this job transcribes (model download included): a phone that
  // locks its screen suspends the tab. Released when transcription ends, however it ends.
  const releaseWakeLock = holdScreenWakeLock();
  try {
    await transcribeWithResume(jobId, audio, resuming);
  } finally {
    releaseWakeLock();
  }
}

async function transcribeWithResume(jobId: string, audio: { blob: Blob }, resuming: boolean): Promise<void> {
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
    const friendly = new Error(describeTranscriptionError(message));
    if (!isAbortError(err)) {
      errorReporter.report({
        kind: "model_download",
        stage: "download",
        code: err instanceof InsufficientStorageError ? "insufficient_storage" : isNetworkFailureMessage(message) ? "network" : errorCodeOf(err),
        error: err,
      });
    }
    errorReporter.markReported(friendly);
    throw friendly;
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

  const prior = priorSecondsPerAudioSecond({ modelId: settings.whisperModel, webgpu: readDeviceFacts().webgpu });
  let resumeLabel: string | null = resuming ? "Resuming" : null;
  const onWindowProgress = (w: WindowProgress) => {
    transcribeStartMs ??= Date.now();
    if (w.doneSeconds > w.resumedFromSeconds) resumeLabel = null; // a window finished: plain "Transcribing" again
    const fraction = w.totalSeconds > 0 ? Math.min(1, w.doneSeconds / w.totalSeconds) : null;
    const label =
      resumeLabel !== null
        ? w.resumedFromSeconds > 0
          ? `Resuming from ${formatTimestamp(w.resumedFromSeconds)}…`
          : "Resuming…"
        : fraction !== null
          ? `Transcribing — ${Math.round(fraction * 100)}%`
          : STAGE_LABEL.transcribing;
    const left = estimateSecondsLeft({
      totalAudioSeconds: w.totalSeconds,
      doneAudioSeconds: w.doneSeconds,
      measuredAudioSeconds: w.measuredSeconds,
      measuredMs: w.measuredMs,
      prior,
    });
    setProgress(jobId, { label, fraction, detail: formatTimeLeft(left) });
  };

  let transcript: Transcript | undefined;
  try {
    // A phone may suspend this tab while it's in the background, killing or freezing the
    // worker. When that happens we wait for the visitor to come back and restart the
    // transcription (a few times at most — see checkpoints.ts).
    for (let attempt = 0; ; attempt++) {
      const stopAttemptTracking = startHiddenTracking();
      const hiddenAtStart = isPageHidden();
      try {
        transcript = await transcribeAudio(audio.blob, settings.whisperModel, settings.whisperDtype, onProgress, {
          onWindowProgress,
        });
        stopAttemptTracking();
        break;
      } catch (err) {
        const wasHidden = hiddenAtStart || stopAttemptTracking() > 0 || isPageHidden();
        if (!isInterruption(err, wasHidden) || attempt >= MAX_IN_SESSION_RESUMES) throw err;
        setProgress(jobId, {
          label: "Paused while this tab was in the background",
          fraction: null,
          detail: "It continues where it left off when you come back to this tab.",
        });
        await waitUntilVisible();
        resumeLabel = "Resuming";
        setProgress(jobId, { label: "Resuming…", fraction: null, detail: null });
      }
    }
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
  await clearCheckpoint(jobId);
}

/** In-session automatic resumes after the tab was backgrounded mid-transcription. */
const MAX_IN_SESSION_RESUMES = 3;
/** Automatic resumes on page load (the tab was closed/reloaded mid-transcription). */
const MAX_AUTO_RESUMES_ON_LOAD = 3;

function isPageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** A transcription failure caused by the tab being in the background (the OS froze or killed
 * the worker), or a worker that stopped answering — worth resuming rather than failing. Checked
 * by name so this doesn't depend on transcribe.ts's classes (tests mock that module). */
export function isInterruption(err: unknown, wasHidden: boolean): boolean {
  const name = typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
  if (name === "TranscriptionStalledError") return true;
  return wasHidden && name === "TranscriptionError";
}

function waitUntilVisible(): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState === "visible") return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
  });
}

// Callers mark the job running (and "queued") BEFORE enqueueing, so callers
// polling job state already see a non-terminal status — otherwise the UI's
// poll loop would see a stale "done"/"error" and stop.
async function markQueued(jobId: string): Promise<void> {
  runningJobIds.add(jobId);
  stageByJob.set(jobId, "queued");
  setProgress(jobId, { label: STAGE_LABEL.queued, fraction: null });
  await db.updateJob(jobId, { status: "queued", error: null });
}

const JOB_LOCK_PREFIX = "recipe-transcriber-job:";

type LocksLike = {
  request(name: string, callback: () => Promise<void>): Promise<void>;
  query?(): Promise<{ held?: { name?: string }[]; pending?: { name?: string }[] }>;
};

function webLocks(): LocksLike | null {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LocksLike }).locks : undefined;
  return locks && typeof locks.request === "function" ? locks : null;
}

/** Runs `task` holding a Web Lock named after the job (where supported), so another tab of the
 * app can tell this job is being worked on (see recoverInterruptedJobs). */
function withJobLock(jobId: string, task: () => Promise<void>): Promise<void> {
  const locks = webLocks();
  return locks ? locks.request(`${JOB_LOCK_PREFIX}${jobId}`, task) : task();
}

/** Job ids another tab is processing right now (empty where Web Locks are unsupported). */
async function jobsLockedElsewhere(): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const snapshot = await webLocks()?.query?.();
    for (const lock of [...(snapshot?.held ?? []), ...(snapshot?.pending ?? [])]) {
      if (lock.name?.startsWith(JOB_LOCK_PREFIX)) out.add(lock.name.slice(JOB_LOCK_PREFIX.length));
    }
  } catch {
    /* unsupported */
  }
  return out;
}

async function guarded(jobId: string, task: () => Promise<void>): Promise<void> {
  try {
    await withJobLock(jobId, task);
  } catch (err) {
    reportPipelineFailure(jobId, err);
    const message = err instanceof Error ? err.message : String(err);
    await setError(jobId, message).catch(() => undefined);
  } finally {
    stageByJob.delete(jobId);
    runningJobIds.delete(jobId);
    setProgress(jobId, null);
  }
}

/**
 * Queues the full pipeline (transcribe -> extract -> verify) for a job.
 * Resolves once the job is marked queued, not when the pipeline finishes.
 */
export async function runPipeline(jobId: string, options: { resuming?: boolean } = {}): Promise<void> {
  const resuming = options.resuming === true;
  await markQueued(jobId);
  void enqueue(() =>
    guarded(jobId, async () => {
      await setStatus(jobId, "transcribing");
      setProgress(jobId, { label: resuming ? "Resuming…" : STAGE_LABEL.transcribing, fraction: null });
      await transcribeAndSave(jobId, resuming);
      await finish(jobId, "extracted");
    }),
  );
}

/** Queues extract+verify from the job's saved transcript. Resolves once queued.
 * Only valid when the job is not currently running and a transcript exists
 * (callers should check both — see index.ts's reextract()). */
export async function runReextract(jobId: string): Promise<void> {
  await markQueued(jobId);
  void enqueue(() => guarded(jobId, () => finish(jobId, "reextracted")));
}

/**
 * A job made from pasted captions (no audio): its transcript is already saved, so it goes
 * straight to the finish step as a first extraction — no speech model, no transcription.
 * Not queued behind a running transcription (that only serializes Whisper); resolves once
 * the job is marked queued.
 */
export async function runFromTranscript(jobId: string): Promise<void> {
  await markQueued(jobId);
  void guarded(jobId, () => finish(jobId, "extracted"));
}

/** Re-runs the full pipeline from stored audio. Only valid from an error
 * state (callers should check — see index.ts's retry()). Goes through the same
 * model-consent gate as a fresh upload (startPipeline) rather than calling runPipeline
 * directly: an error retried here may be exactly "the model download was interrupted",
 * in which case the model is still not fully cached and the dialog should show again. */
export async function runRetry(jobId: string): Promise<void> {
  await resetAutoResumes(jobId);
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
export async function startPipeline(jobId: string, options: { resuming?: boolean } = {}): Promise<void> {
  const settings = reloadSettings();
  const cached = await isModelCached(settings.whisperModel, settings.whisperDtype);
  if (cached) {
    await runPipeline(jobId, options);
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
 * On load, jobs left in a non-terminal status by a previous page session (the tab was closed,
 * reloaded, or killed by the phone while in the background):
 *  - a job that was transcribing, with its audio here, resumes automatically — from its last
 *    checkpointed window (transcribe.ts) — up to MAX_AUTO_RESUMES_ON_LOAD times, so a clip that
 *    crashes the tab every time doesn't loop forever;
 *  - anything else is marked as an error pointing at Retry, so the UI doesn't show it stuck.
 * Jobs another open tab is processing right now (it holds the job's Web Lock) are left alone.
 */
export async function recoverInterruptedJobs(): Promise<void> {
  const jobs = await db.listJobs();
  const TERMINAL: JobStatus[] = ["done", "error"];
  const lockedElsewhere = await jobsLockedElsewhere();
  for (const job of jobs) {
    if (!TERMINAL.includes(job.status) && !lockedElsewhere.has(job.id) && !runningJobIds.has(job.id)) {
      if (job.status === "transcribing" && (await db.getAudio(job.id))) {
        const resumes = await noteAutoResume(job.id);
        if (resumes <= MAX_AUTO_RESUMES_ON_LOAD) {
          await startPipeline(job.id, { resuming: true }).catch(() => undefined);
          continue;
        }
      }
      // A job paused at "queued" was usually waiting for the model-download OK — not a failure.
      if (job.status !== "queued") {
        errorReporter.report({ kind: "pipeline", stage: job.status, code: "interrupted", error: "Interrupted: the tab was closed while processing" });
      }
      await setError(job.id, "Interrupted — the tab was closed while processing. Press Retry.").catch(() => undefined);
    }
  }
}

export { ExtractionError, VerificationError };
