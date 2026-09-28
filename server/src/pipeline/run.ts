import { TERMINAL_STATUSES, type Job, type JobStatus, type Recipe, type VersionSource } from "@recipe/shared";
import { extractRecipe, ExtractionError } from "./extract.ts";
import { transcribeJob } from "./transcribe.ts";
import { verifyRecipe, VerificationError } from "./verify.ts";
import { getJob, getTranscript, listJobs, saveVersion, updateJob } from "../storage.ts";

// Whisper transcription is CPU/GPU heavy, so pipeline runs are serialized
// through a simple in-process queue — one job at a time, regardless of how
// many uploads/reextracts come in concurrently.
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

export function isJobRunning(jobId: string): boolean {
  return runningJobIds.has(jobId);
}

async function setStatus(jobId: string, status: JobStatus): Promise<void> {
  await updateJob(jobId, { status });
}

async function setError(jobId: string, message: string): Promise<void> {
  await updateJob(jobId, { status: "error", error: message });
}

/**
 * Runs extract -> verify against the job's saved transcript and stores the
 * result as a new version. Extraction failure propagates (fails the job);
 * verification failure does not — it's downgraded to a single "other"
 * warning on the saved recipe.
 */
async function extractVerifyAndSave(jobId: string, source: VersionSource): Promise<void> {
  const transcript = await getTranscript(jobId);
  if (!transcript) {
    throw new Error(`Job ${jobId} has no transcript to extract from`);
  }

  await setStatus(jobId, "extracting");
  const extracted = await extractRecipe(transcript);

  await setStatus(jobId, "verifying");
  let warnings: Recipe["warnings"];
  try {
    warnings = await verifyRecipe(transcript, extracted);
  } catch (err) {
    const message = err instanceof VerificationError ? err.message : String(err);
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
  await saveVersion(jobId, recipe, source);
  await updateJob(jobId, { status: "done", error: null, title: recipe.title });
}

// Callers mark the job running (and "queued") BEFORE enqueueing, so the HTTP
// response already shows a non-terminal status — otherwise the UI's poll loop
// sees the stale "done"/"error" and stops — and a double-click gets a 409.
async function markQueued(jobId: string): Promise<void> {
  runningJobIds.add(jobId);
  await updateJob(jobId, { status: "queued", error: null });
}

async function guarded(jobId: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setError(jobId, message).catch(() => undefined);
  } finally {
    runningJobIds.delete(jobId);
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
      await transcribeJob(jobId);
      await extractVerifyAndSave(jobId, "extracted");
    }),
  );
}

/** Queues extract+verify from the job's saved transcript. Resolves once queued. */
export async function runReextract(jobId: string): Promise<void> {
  await markQueued(jobId);
  void enqueue(() => guarded(jobId, () => extractVerifyAndSave(jobId, "reextracted")));
}

/**
 * On server start, any job left in a non-terminal status (from a previous
 * process that died mid-pipeline) can never resume — mark it as an error so
 * the UI doesn't show it stuck "transcribing" forever.
 */
export async function recoverInterruptedJobs(): Promise<void> {
  const jobs = await listJobs();
  for (const job of jobs) {
    if (!TERMINAL_STATUSES.includes(job.status)) {
      await setError(
        job.id,
        "Interrupted by server restart — use re-extract or re-upload.",
      ).catch(() => undefined);
    }
  }
}

export async function assertJobExists(jobId: string): Promise<Job> {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  return job;
}

// Re-exported for extraction-error identification at the call site (index.ts).
export { ExtractionError };
