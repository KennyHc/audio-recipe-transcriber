import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { writeFile } from "node:fs/promises";
import type { ExtractedRecipe, Job, JobStatus, Transcript } from "@recipe/shared";
import { app } from "../app";
import {
  createJob,
  deleteJob,
  getJob,
  getLatestVersion,
  originalAudioPath,
  saveTranscript,
  saveVersion,
} from "../storage";
import { extractRecipe } from "./extract";
import { recoverInterruptedJobs, runPipeline, runReextract } from "./run";
import { transcribeJob } from "./transcribe";
import { verifyRecipe } from "./verify";

// Only the expensive leaves are mocked (whisper, Claude). run.ts, storage and the
// HTTP app are the real modules.
vi.mock("./transcribe", () => ({ transcribeJob: vi.fn() }));
vi.mock("./extract", () => ({ extractRecipe: vi.fn(), ExtractionError: class extends Error {} }));
vi.mock("./verify", () => ({ verifyRecipe: vi.fn(), VerificationError: class extends Error {} }));

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
  await createJob({
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

async function waitForStatus(status: JobStatus, timeoutMs = 2000): Promise<Job> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await getJob(jobId);
    if (job?.status === status) return job;
    if (Date.now() > deadline) throw new Error(`job stuck at ${job?.status}, wanted ${status}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  jobId = `test-${nanoid()}`;
  vi.mocked(transcribeJob).mockImplementation(async (id) => {
    await saveTranscript(id, transcript);
    return transcript;
  });
  vi.mocked(extractRecipe).mockResolvedValue(extracted);
  vi.mocked(verifyRecipe).mockResolvedValue([]);
});

afterEach(async () => {
  vi.resetAllMocks();
  await deleteJob(jobId).catch(() => undefined);
});

describe("runPipeline", () => {
  it("transcribes, extracts, verifies and saves v1", async () => {
    await seedJob();
    await runPipeline(jobId);

    const job = await waitForStatus("done");
    expect(job.error).toBeNull();
    expect(job.title).toBe("Flour Mix");

    const latest = await getLatestVersion(jobId);
    expect(latest?.meta).toMatchObject({ version: 1, source: "extracted" });
    expect(latest?.recipe.warnings).toEqual([]);
  });

  it("fails the job when extraction fails", async () => {
    vi.mocked(extractRecipe).mockRejectedValue(new Error("extractor refused"));
    await seedJob();
    await runPipeline(jobId);

    const job = await waitForStatus("error");
    expect(job.error).toBe("extractor refused");
    expect(await getLatestVersion(jobId)).toBeNull();
  });

  it("still finishes when verification fails, with one 'other' warning", async () => {
    vi.mocked(verifyRecipe).mockRejectedValue(new Error("haiku timeout"));
    await seedJob();
    await runPipeline(jobId);

    await waitForStatus("done");
    const warnings = (await getLatestVersion(jobId))?.recipe.warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings?.[0]).toMatchObject({ kind: "other", target: null });
    expect(warnings?.[0]?.message).toContain("haiku timeout");
  });
});

describe("runReextract", () => {
  it("is already 'queued' when it returns, then saves a 'reextracted' version and clears the old error", async () => {
    await seedJob({ status: "error", error: "old failure" });
    await saveTranscript(jobId, transcript);

    await runReextract(jobId);
    // Regression: the UI stops polling on a terminal status, so this must not be "error"/"done".
    expect((await getJob(jobId))?.status).toBe("queued");

    const job = await waitForStatus("done");
    expect(job.error).toBeNull();
    expect((await getLatestVersion(jobId))?.meta).toMatchObject({ version: 1, source: "reextracted" });
  });

  it("returns 409 from the real route when re-extract is clicked twice", async () => {
    await seedJob({ status: "done" });
    await saveTranscript(jobId, transcript);
    await saveVersion(jobId, { ...extracted, warnings: [] }, "extracted");

    let release!: (r: ExtractedRecipe) => void;
    vi.mocked(extractRecipe).mockImplementation(() => new Promise((resolve) => (release = resolve)));

    const first = await app.request(`/api/jobs/${jobId}/reextract`, { method: "POST" });
    const second = await app.request(`/api/jobs/${jobId}/reextract`, { method: "POST" });
    expect(first.status).toBe(200);
    expect(((await first.json()) as Job).status).toBe("queued");
    expect(second.status).toBe(409);

    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release(extracted);
    await waitForStatus("done");
    expect((await getLatestVersion(jobId))?.meta.version).toBe(2);
  });
});

describe("POST /api/jobs/:id/retry", () => {
  it("retries an errored job: 200 with status 'queued', then ends 'done' with v1", async () => {
    await seedJob({ status: "error", error: "whisper-cli exited with code 1" });
    await writeFile(originalAudioPath(jobId, "mp3"), "fake audio bytes");

    const res = await app.request(`/api/jobs/${jobId}/retry`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Job).status).toBe("queued");

    const job = await waitForStatus("done");
    expect(job.error).toBeNull();
    expect(job.title).toBe("Flour Mix");

    const latest = await getLatestVersion(jobId);
    expect(latest?.meta).toMatchObject({ version: 1, source: "extracted" });
  });

  it("returns 409 when retrying a job that isn't in an error state", async () => {
    await seedJob({ status: "done" });

    const res = await app.request(`/api/jobs/${jobId}/retry`, { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("returns 409 when the original audio file is gone", async () => {
    await seedJob({ status: "error", error: "some failure" });
    // No audio file written for this job.

    const res = await app.request(`/api/jobs/${jobId}/retry`, { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("returns 404 when retrying a missing job", async () => {
    const res = await app.request(`/api/jobs/does-not-exist/retry`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("recoverInterruptedJobs", () => {
  it("marks jobs left mid-pipeline as errors", async () => {
    await seedJob({ status: "transcribing" });
    await recoverInterruptedJobs();

    const job = await getJob(jobId);
    expect(job?.status).toBe("error");
    expect(job?.error).toMatch(/Interrupted by server restart/);
  });
});

describe("ensureAmountWarnings", () => {
  it("adds a warning for vague/inferred ingredients without an amount, unless one exists", async () => {
    const { ensureAmountWarnings } = await vi.importActual<typeof import("./verify")>("./verify");
    const recipe: ExtractedRecipe = {
      ...extracted,
      ingredients: [
        ...extracted.ingredients,
        { quantity: null, unit: null, item: "parmesan", prep: null, sourceText: "stir in the parmesan", timestamp: 4, confidence: "inferred" },
        { quantity: null, unit: null, item: "olive oil", prep: null, sourceText: "a good glug", timestamp: 1, confidence: "vague" },
        { quantity: null, unit: null, item: "salt", prep: null, sourceText: "salt to taste", timestamp: 5, confidence: "stated" },
      ],
    };
    const existing = [{ kind: "vague_quantity" as const, message: "glug", target: "ingredients[2]", suggestion: "~2 tbsp" }];

    const out = ensureAmountWarnings(recipe, existing);
    expect(out.map((w) => [w.kind, w.target])).toEqual([
      ["vague_quantity", "ingredients[2]"], // model's own warning kept
      ["missing_ingredient", "ingredients[1]"], // parmesan backfilled
    ]); // "stated" salt and the stated flour get nothing
  });
});
