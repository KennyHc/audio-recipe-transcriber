import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nanoid } from "nanoid";
import { app } from "./app";
import { createJob, saveVersion, saveTranscript, deleteJob as deleteJobFromStorage } from "./storage";
import type { Job, Recipe, Transcript } from "@recipe/shared";

// Mock the pipeline/run module
vi.mock("./pipeline/run", () => ({
  isJobRunning: vi.fn(() => false),
  runPipeline: vi.fn(async () => undefined),
  runReextract: vi.fn(async () => undefined),
  recoverInterruptedJobs: vi.fn(async () => undefined),
  ExtractionError: class ExtractionError extends Error {},
}));

describe("HTTP routes (real app)", () => {
  let testJobId: string;

  beforeEach(() => {
    testJobId = nanoid();
  });

  afterEach(async () => {
    try {
      await deleteJobFromStorage(testJobId);
    } catch {
      // ignore
    }
  });

  describe("POST /api/jobs with file validation", () => {
    it("rejects unsupported file extensions with 400", async () => {
      const formData = new FormData();
      const file = new File([Buffer.from("fake audio")], "test.xyz");
      formData.append("audio", file);

      const res = await app.request(
        new Request("http://localhost/api/jobs", { method: "POST", body: formData }),
      );

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Unsupported file extension");
    });

    it("accepts valid audio extensions", async () => {
      const formData = new FormData();
      const file = new File([Buffer.from("fake audio")], "test.mp3");
      formData.append("audio", file);

      const res = await app.request(
        new Request("http://localhost/api/jobs", { method: "POST", body: formData }),
      );

      expect(res.status).toBe(201);
      const data = (await res.json()) as Job;
      expect(data.fileName).toBe("test.mp3");
      expect(data.status).toBe("queued");
    });
  });

  describe("GET /api/jobs/:id returns 404 for missing job", () => {
    it("returns 404 when job not found", async () => {
      const res = await app.request("/api/jobs/non-existent-id");
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/jobs/:id/recipe", () => {
    it("rejects invalid recipe with 400", async () => {
      // Create a job first
      const now = new Date().toISOString();
      const job: Job = {
        id: testJobId,
        fileName: "test.mp3",
        status: "done",
        error: null,
        title: null,
        createdAt: now,
        updatedAt: now,
      };
      await createJob(job);

      // Try to PUT invalid recipe
      const res = await app.request(
        new Request(`http://localhost/api/jobs/${testJobId}/recipe`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invalid: "data" }),
        }),
      );

      expect(res.status).toBe(400);
    });

    it("saves valid recipe and returns new version with source 'edited'", async () => {
      // Create a job
      const now = new Date().toISOString();
      const job: Job = {
        id: testJobId,
        fileName: "test.mp3",
        status: "done",
        error: null,
        title: null,
        createdAt: now,
        updatedAt: now,
      };
      await createJob(job);

      const recipe: Recipe = {
        title: "Edited Recipe",
        description: null,
        servings: null,
        totalTimeMinutes: null,
        ingredients: [],
        steps: [],
        tips: [],
        warnings: [],
      };

      const res = await app.request(
        new Request(`http://localhost/api/jobs/${testJobId}/recipe`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(recipe),
        }),
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as { meta: { source: string }; recipe: Recipe };
      expect(data.meta.source).toBe("edited");
      expect(data.recipe.title).toBe("Edited Recipe");
    });
  });

  describe("POST /api/jobs/:id/recipe/rollback", () => {
    it("returns 404 for missing target version", async () => {
      // Create a job
      const now = new Date().toISOString();
      const job: Job = {
        id: testJobId,
        fileName: "test.mp3",
        status: "done",
        error: null,
        title: null,
        createdAt: now,
        updatedAt: now,
      };
      await createJob(job);

      const res = await app.request(
        new Request(`http://localhost/api/jobs/${testJobId}/recipe/rollback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: 999 }),
        }),
      );

      expect(res.status).toBe(404);
    });

    it("creates new rollback version with note", async () => {
      // Create job and save versions
      const now = new Date().toISOString();
      const job: Job = {
        id: testJobId,
        fileName: "test.mp3",
        status: "done",
        error: null,
        title: null,
        createdAt: now,
        updatedAt: now,
      };
      await createJob(job);

      const recipe: Recipe = {
        title: "V1",
        description: null,
        servings: null,
        totalTimeMinutes: null,
        ingredients: [],
        steps: [],
        tips: [],
        warnings: [],
      };
      await saveVersion(testJobId, recipe, "extracted");

      const res = await app.request(
        new Request(`http://localhost/api/jobs/${testJobId}/recipe/rollback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: 1 }),
        }),
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        meta: { source: string; note: string; version: number };
        recipe: Recipe;
      };
      expect(data.meta.source).toBe("rollback");
      expect(data.meta.note).toBe("Restored from v1");
      expect(data.meta.version).toBe(2);
    });
  });

  describe("POST /api/jobs/:id/reextract", () => {
    it("succeeds when transcript available and job not running", async () => {
      // Create a job with transcript
      const now = new Date().toISOString();
      const job: Job = {
        id: testJobId,
        fileName: "test.mp3",
        status: "done",
        error: null,
        title: null,
        createdAt: now,
        updatedAt: now,
      };
      await createJob(job);

      const transcript: Transcript = {
        language: "en",
        segments: [
          { start: 0, end: 5, text: "Add flour" },
          { start: 5, end: 10, text: "Mix well" },
        ],
      };
      await saveTranscript(testJobId, transcript);

      // With mocked runReextract and isJobRunning returning false, reextract should succeed
      const res = await app.request(
        new Request(`http://localhost/api/jobs/${testJobId}/reextract`, { method: "POST" }),
      );
      expect(res.status).toBe(200);
    });

    it("returns 409 when no transcript available", async () => {
      // Create a job without transcript
      const now = new Date().toISOString();
      const job: Job = {
        id: testJobId,
        fileName: "test.mp3",
        status: "done",
        error: null,
        title: null,
        createdAt: now,
        updatedAt: now,
      };
      await createJob(job);

      // Without transcript, reextract should return 409
      const res = await app.request(
        new Request(`http://localhost/api/jobs/${testJobId}/reextract`, { method: "POST" }),
      );
      expect(res.status).toBe(409);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("No transcript");
    });
  });
});

describe("PUT /api/jobs/:id/transcript", () => {
  it("saves a corrected transcript and rejects bad bodies and unknown jobs", async () => {
    const { createJob, deleteJob, saveTranscript, getTranscript } = await import("./storage");
    const id = `test-transcript-${Date.now()}`;
    const now = new Date().toISOString();
    await createJob({ id, fileName: "a.mp3", status: "done", error: null, title: null, createdAt: now, updatedAt: now });
    await saveTranscript(id, { language: "en", segments: [{ start: 0, end: 2, text: "chop all green onions" }] });

    const corrected = { language: "en", segments: [{ start: 0, end: 2, text: "chop four green onions" }] };
    const ok = await app.request(`/api/jobs/${id}/transcript`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corrected) });
    expect(ok.status).toBe(200);
    expect((await getTranscript(id))?.segments[0]?.text).toBe("chop four green onions");

    const bad = await app.request(`/api/jobs/${id}/transcript`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segments: "nope" }) });
    expect(bad.status).toBe(400);
    const missing = await app.request(`/api/jobs/no-such-job/transcript`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corrected) });
    expect(missing.status).toBe(404);
    await deleteJob(id);
  });
});
