import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedRecipe, Job } from "@recipe/shared";
import * as db from "./db";
import { extractRecipe, verifyRecipe } from "./claude";
import { transcribeAudio } from "./transcribe";
import { createBrowserBackend, createCaptionsJob } from "./index";

// Browser/hosted modes: a captions job is a local job without audio whose transcript goes
// straight to extract + verify. Only Claude and Whisper are mocked.
vi.mock("./transcribe", () => ({ transcribeAudio: vi.fn() }));
vi.mock("./claude", () => ({
  extractRecipe: vi.fn(),
  verifyRecipe: vi.fn(),
  ExtractionError: class extends Error {},
  VerificationError: class extends Error {},
}));
vi.mock("./modelCatalog", () => ({ isModelCached: vi.fn() }));
vi.mock("./modelDownloader", () => ({ ensureModelDownloaded: vi.fn(), InsufficientStorageError: class extends Error {} }));

const extracted: ExtractedRecipe = {
  title: "Egg Fried Rice",
  description: null,
  servings: null,
  totalTimeMinutes: null,
  ingredients: [{ quantity: 2, unit: null, item: "eggs", prep: null, sourceText: "two eggs", timestamp: 0, confidence: "stated" }],
  steps: [{ text: "Beat the eggs.", timestamp: 0, durationMinutes: null, temperature: null }],
  tips: [],
};

async function waitForStatus(id: string, status: Job["status"]): Promise<Job> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const job = await db.getJob(id);
    if (job?.status === status) return job;
    if (Date.now() > deadline) throw new Error(`stuck at ${job?.status}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  vi.mocked(extractRecipe).mockResolvedValue(extracted);
  vi.mocked(verifyRecipe).mockResolvedValue([]);
});

afterEach(async () => {
  vi.resetAllMocks();
  await db._resetDbConnectionForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("recipe-transcriber");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe("createCaptionsJob (browser/hosted)", () => {
  it("creates a job without audio, saves the parsed transcript, and strips timestamps of plain text", async () => {
    const onJobCreated = vi.fn();
    const job = await createCaptionsJob({ text: "Beat two eggs. Fry the rice." }, { onJobCreated });
    expect(job.fileName).toBe("Pasted captions");
    expect(onJobCreated).toHaveBeenCalledWith(job.id);
    expect(await db.getAudio(job.id)).toBeNull();
    await waitForStatus(job.id, "done");
    const recipe = (await db.getLatestVersion(job.id))!.recipe;
    expect(recipe.title).toBe("Egg Fried Rice");
    expect(recipe.steps[0]!.timestamp).toBeNull();
    expect(recipe.ingredients[0]!.timestamp).toBeNull();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("keeps timestamps from timed captions (.srt)", async () => {
    vi.mocked(extractRecipe).mockResolvedValue({ ...extracted, steps: [{ ...extracted.steps[0]!, timestamp: 3 }] });
    const srt = "1\n00:00:01,000 --> 00:00:03,000\nTwo eggs\n\n2\n00:00:03,000 --> 00:00:06,000\nBeat them\n";
    const job = await createCaptionsJob({ text: srt, fileName: "video.srt" });
    expect(job.fileName).toBe("video.srt");
    await waitForStatus(job.id, "done");
    expect((await db.getTranscript(job.id))!.segments[0]).toEqual({ start: 1, end: 3, text: "Two eggs" });
    expect((await db.getLatestVersion(job.id))!.recipe.steps[0]!.timestamp).toBe(3);
  });

  it("rejects unusable text without creating a job", async () => {
    await expect(createCaptionsJob({ text: "WEBVTT\n\n" })).rejects.toThrow(/couldn't find any words/);
    expect(await db.listJobs()).toEqual([]);
  });

  it("Retry re-runs extraction (there's no audio to re-transcribe)", async () => {
    vi.mocked(extractRecipe).mockRejectedValueOnce(new Error("Claude is busy"));
    const job = await createCaptionsJob({ text: "Beat two eggs. Fry the rice." });
    await waitForStatus(job.id, "error");
    const backend = createBrowserBackend();
    await backend.retry(job.id);
    const done = await waitForStatus(job.id, "done");
    expect(done.error).toBeNull();
    expect((await db.getLatestVersion(job.id))!.meta).toMatchObject({ version: 1, source: "extracted" });
    expect(transcribeAudio).not.toHaveBeenCalled();
  });
});
