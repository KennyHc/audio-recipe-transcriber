import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedRecipe, Job, Transcript } from "@recipe/shared";
import * as db from "./db";
import { extractRecipe, verifyRecipe } from "./claude";
import { transcribeAudio } from "./transcribe";
import { isModelCached } from "./modelCatalog";
import { ensureModelDownloaded } from "./modelDownloader";
import {
  getProgress,
  isAwaitingModelConsent,
  recoverInterruptedJobs,
  resumeAfterConsent,
  runPipeline,
  runReextract,
  runRetry,
  setFinishStep,
  startPipeline,
} from "./runner";
import { errorReporter } from "@/lib/errorReporting";

// Only the expensive leaves are mocked (Whisper worker, Claude, the Cache Storage check, and
// the chunked model downloader — which has its own dedicated test file, modelDownloader.test.ts).
// runner.ts and db.ts are the real modules — mirrors server/src/pipeline/run.test.ts.
vi.mock("./transcribe", () => ({ transcribeAudio: vi.fn() }));
vi.mock("./claude", () => ({
  extractRecipe: vi.fn(),
  verifyRecipe: vi.fn(),
  ExtractionError: class extends Error {},
  VerificationError: class extends Error {},
}));
vi.mock("./modelCatalog", () => ({ isModelCached: vi.fn() }));
vi.mock("./modelDownloader", () => ({ ensureModelDownloaded: vi.fn(), InsufficientStorageError: class extends Error {} }));

const transcript: Transcript = {
  language: "en",
  segments: [
    { start: 0, end: 4, text: "Two cups of flour" },
    { start: 4, end: 8, text: "Mix it well" },
  ],
};

const extracted: ExtractedRecipe = {
  title: "Flour Mix",
  description: null,
  servings: null,
  totalTimeMinutes: null,
  ingredients: [
    {
      quantity: 2,
      unit: "cup",
      item: "flour",
      prep: null,
      sourceText: "Two cups of flour",
      timestamp: 0,
      confidence: "stated",
    },
  ],
  steps: [{ text: "Mix the flour.", timestamp: 4, durationMinutes: null, temperature: null }],
  tips: [],
};

let jobId: string;

async function seedJob(patch: Partial<Job> = {}): Promise<void> {
  const now = new Date().toISOString();
  await db.createJob({
    id: jobId,
    fileName: "clip.mp3",
    status: "queued",
    error: null,
    title: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  });
}

async function waitForStatus(status: Job["status"], timeoutMs = 2000): Promise<Job> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await db.getJob(jobId);
    if (job?.status === status) return job;
    if (Date.now() > deadline) throw new Error(`job stuck at ${job?.status}, wanted ${status}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  jobId = `test-${Math.random().toString(36).slice(2)}`;
  vi.mocked(transcribeAudio).mockImplementation(async (_blob, _model, _dtype) => transcript);
  vi.mocked(extractRecipe).mockResolvedValue(extracted);
  vi.mocked(verifyRecipe).mockResolvedValue([]);
  // Default: the speech model is already cached, so startPipeline/runRetry behave exactly
  // like the pre-consent-gate runPipeline for the existing tests below.
  vi.mocked(isModelCached).mockResolvedValue(true);
  // The download itself is exercised in modelDownloader.test.ts — here it's a no-op so the
  // worker's transcribeAudio() call is reached (matching startPipeline's isModelCached gate
  // having already established the model is available).
  vi.mocked(ensureModelDownloaded).mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.resetAllMocks();
  await db.deleteJobRecord(jobId).catch(() => undefined);
  await db._resetDbConnectionForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("recipe-transcriber");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

describe("runPipeline", () => {
  it("transcribes, extracts, verifies and saves v1 as 'extracted'", async () => {
    await seedJob();
    await db.saveAudio(jobId, "clip.mp3", new Blob(["audio"]));

    await runPipeline(jobId);

    const job = await waitForStatus("done");
    expect(job.error).toBeNull();
    expect(job.title).toBe("Flour Mix");

    const latest = await db.getLatestVersion(jobId);
    expect(latest?.meta).toMatchObject({ version: 1, source: "extracted" });
    expect(latest?.recipe.warnings).toEqual([]);
  });

  it("marks the job 'queued' synchronously (before the pipeline runs) so polling never sees a stale terminal status", async () => {
    await seedJob({ status: "error", error: "old" });
    await db.saveAudio(jobId, "clip.mp3", new Blob(["audio"]));

    await runPipeline(jobId);
    expect((await db.getJob(jobId))?.status).toBe("queued");

    await waitForStatus("done");
  });

  it("fails the job when extraction fails", async () => {
    vi.mocked(extractRecipe).mockRejectedValue(new Error("extractor refused"));
    await seedJob();
    await db.saveAudio(jobId, "clip.mp3", new Blob(["audio"]));

    await runPipeline(jobId);

    const job = await waitForStatus("error");
    expect(job.error).toBe("extractor refused");
    expect(await db.getLatestVersion(jobId)).toBeNull();
  });

  it("still finishes 'done' when verification fails, with exactly one 'other' warning", async () => {
    vi.mocked(verifyRecipe).mockRejectedValue(new Error("haiku timeout"));
    await seedJob();
    await db.saveAudio(jobId, "clip.mp3", new Blob(["audio"]));

    await runPipeline(jobId);

    await waitForStatus("done");
    const warnings = (await db.getLatestVersion(jobId))?.recipe.warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings?.[0]).toMatchObject({ kind: "other", target: null });
    expect(warnings?.[0]?.message).toContain("haiku timeout");
  });
});

describe("runReextract", () => {
  it("is 'queued' immediately, then saves a new version with source 'reextracted' and clears the old error", async () => {
    await seedJob({ status: "error", error: "old failure" });
    await db.saveTranscript(jobId, transcript);

    await runReextract(jobId);
    expect((await db.getJob(jobId))?.status).toBe("queued");

    const job = await waitForStatus("done");
    expect(job.error).toBeNull();
    expect((await db.getLatestVersion(jobId))?.meta).toMatchObject({ version: 1, source: "reextracted" });
  });
});

describe("runRetry", () => {
  it("re-runs the full pipeline from stored audio", async () => {
    await seedJob({ status: "error", error: "whisper crashed" });
    await db.saveAudio(jobId, "clip.mp3", new Blob(["audio"]));

    await runRetry(jobId);

    const job = await waitForStatus("done");
    expect(job.error).toBeNull();
    expect((await db.getLatestVersion(jobId))?.meta).toMatchObject({ version: 1, source: "extracted" });
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
  });
});

describe("startPipeline / resumeAfterConsent (model-download consent gate)", () => {
  it("runs the pipeline immediately when the speech model is already cached", async () => {
    await seedJob();
    await db.saveAudio(jobId, "clip.mp3", new Blob(["audio"]));

    await startPipeline(jobId);

    expect(isAwaitingModelConsent(jobId)).toBe(false);
    const job = await waitForStatus("done");
    expect(job.error).toBeNull();
  });

  it("pauses the job (queued, awaitingModelConsent) instead of transcribing when the model isn't cached", async () => {
    vi.mocked(isModelCached).mockResolvedValue(false);
    await seedJob();
    await db.saveAudio(jobId, "clip.mp3", new Blob(["audio"]));

    await startPipeline(jobId);

    expect(isAwaitingModelConsent(jobId)).toBe(true);
    const job = await db.getJob(jobId);
    expect(job?.status).toBe("queued");
    expect(getProgress(jobId)?.awaitingModelConsent).toBe(true);
    expect(transcribeAudio).not.toHaveBeenCalled();

    // Never left running, and never actually transcribes while paused.
    await new Promise((r) => setTimeout(r, 20));
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("resumeAfterConsent starts the pipeline and clears the awaiting flag", async () => {
    vi.mocked(isModelCached).mockResolvedValue(false);
    await seedJob();
    await db.saveAudio(jobId, "clip.mp3", new Blob(["audio"]));
    await startPipeline(jobId);
    expect(isAwaitingModelConsent(jobId)).toBe(true);

    await resumeAfterConsent(jobId);

    expect(isAwaitingModelConsent(jobId)).toBe(false);
    const job = await waitForStatus("done");
    expect(job.error).toBeNull();
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
  });

  it("runRetry re-enters the consent gate: if the model still isn't cached, it pauses again instead of erroring", async () => {
    vi.mocked(isModelCached).mockResolvedValue(false);
    await seedJob({
      status: "error",
      error: "The speech model download was interrupted (connection lost). Press Retry — files that finished downloading are kept.",
    });
    await db.saveAudio(jobId, "clip.mp3", new Blob(["audio"]));

    await runRetry(jobId);

    expect(isAwaitingModelConsent(jobId)).toBe(true);
    const job = await db.getJob(jobId);
    expect(job?.status).toBe("queued");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });
});

describe("recoverInterruptedJobs", () => {
  it("marks jobs left in a non-terminal status as errored, with a message pointing at Retry", async () => {
    await seedJob({ status: "transcribing" });
    await recoverInterruptedJobs();

    const job = await db.getJob(jobId);
    expect(job?.status).toBe("error");
    expect(job?.error).toMatch(/Interrupted.*tab was closed.*Retry/);
  });

  it("leaves terminal jobs (done/error) untouched", async () => {
    await seedJob({ status: "done", title: "Already finished" });
    await recoverInterruptedJobs();

    const job = await db.getJob(jobId);
    expect(job?.status).toBe("done");
    expect(job?.title).toBe("Already finished");
  });
});

describe("finish step seam (cloud mode)", () => {
  afterEach(() => setFinishStep(null));

  it("runs a replaced finish step after transcription instead of local extract+verify", async () => {
    const calls: string[] = [];
    setFinishStep(async (id, source, ctx) => {
      calls.push(`${id}:${source}`);
      await ctx.setStage("extracting", "Making your recipe");
      expect(getProgress(id)?.label).toBe("Making your recipe");
      await db.updateJob(id, { status: "done", title: "From the API" });
    });
    await seedJob();
    await db.saveAudio(jobId, "clip.mp3", new Blob(["audio"]));

    await runPipeline(jobId);
    const job = await waitForStatus("done");

    expect(calls).toEqual([`${jobId}:extracted`]);
    expect(job.title).toBe("From the API");
    expect(extractRecipe).not.toHaveBeenCalled();
    expect(await db.getTranscript(jobId)).toEqual(transcript);
  });

  it("re-extract goes through the replaced step too, and its error fails the job", async () => {
    setFinishStep(async () => {
      throw new Error("You've used your 30 free recipes this month.");
    });
    await seedJob({ status: "error", error: "old" });
    await db.saveTranscript(jobId, transcript);

    await runReextract(jobId);
    const job = await waitForStatus("error");
    expect(job.error).toBe("You've used your 30 free recipes this month.");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("setFinishStep(null) restores local extract+verify", async () => {
    setFinishStep(async () => {
      throw new Error("should not run");
    });
    setFinishStep(null);
    await seedJob();
    await db.saveAudio(jobId, "clip.mp3", new Blob(["audio"]));
    await runPipeline(jobId);
    await waitForStatus("done");
    expect(extractRecipe).toHaveBeenCalled();
  });
});

describe("error reports", () => {
  afterEach(() => setFinishStep(null));

  it("reports a pipeline failure with the stage it failed in", async () => {
    const report = vi.spyOn(errorReporter, "report");
    vi.mocked(extractRecipe).mockRejectedValue(Object.assign(new Error("extractor refused"), { name: "ExtractionError" }));
    await seedJob();
    await db.saveAudio(jobId, "clip.mp3", new Blob(["audio"]));
    await runPipeline(jobId);
    await waitForStatus("error");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: "pipeline", stage: "extracting", code: "ExtractionError" }));
    report.mockRestore();
  });

  it("reports a model download failure once, as model_download (not again as pipeline)", async () => {
    const report = vi.spyOn(errorReporter, "report");
    vi.mocked(ensureModelDownloaded).mockRejectedValue(new TypeError("Failed to fetch"));
    await seedJob();
    await db.saveAudio(jobId, "clip.mp3", new Blob(["audio"]));
    await runPipeline(jobId);
    await waitForStatus("error");
    expect(report.mock.calls.map(([r]) => [r.kind, r.stage, r.code])).toEqual([["model_download", "download", "network"]]);
    report.mockRestore();
  });

  it("doesn't report user-facing API answers (4xx, e.g. the monthly limit)", async () => {
    const report = vi.spyOn(errorReporter, "report");
    setFinishStep(async () => {
      throw Object.assign(new Error("You've used your 30 free recipes this month."), { status: 429, code: "quota_exceeded" });
    });
    await seedJob({ status: "error", error: "old" });
    await db.saveTranscript(jobId, transcript);
    await runReextract(jobId);
    await waitForStatus("error");
    expect(report).not.toHaveBeenCalled();
    report.mockRestore();
  });

  it("reports jobs interrupted mid-stage, but not ones paused at queued", async () => {
    const report = vi.spyOn(errorReporter, "report");
    await seedJob({ status: "transcribing" });
    await recoverInterruptedJobs();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: "pipeline", stage: "transcribing", code: "interrupted" }));
    report.mockClear();
    await db.updateJob(jobId, { status: "queued" });
    await recoverInterruptedJobs();
    expect(report).not.toHaveBeenCalled();
    report.mockRestore();
  });
});
