import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { nanoid } from "nanoid";
import {
  createJob,
  deleteJob,
  getJob,
  listJobs,
  updateJob,
  saveVersion,
  listVersions,
  getVersion,
  getLatestVersion,
  jobDir,
} from "./storage";
import type { Job, Recipe } from "@recipe/shared";
import { existsSync } from "node:fs";

describe("storage", () => {
  let testJobId: string;

  beforeEach(() => {
    testJobId = nanoid();
  });

  afterEach(async () => {
    // Clean up test job
    try {
      await deleteJob(testJobId);
    } catch {
      // ignore if it doesn't exist
    }
  });

  describe("job operations", () => {
    it("creates a job", async () => {
      const now = new Date().toISOString();
      const job: Job = {
        id: testJobId,
        fileName: "test.mp3",
        status: "queued",
        error: null,
        title: null,
        createdAt: now,
        updatedAt: now,
      };

      await createJob(job);
      const retrieved = await getJob(testJobId);

      expect(retrieved).toEqual(job);
    });

    it("gets a non-existent job as null", async () => {
      const job = await getJob("non-existent-id");
      expect(job).toBeNull();
    });

    it("saves and updates a job", async () => {
      // A fixed past timestamp, so updateJob's fresh updatedAt is always different
      // (a 1 ms sleep wasn't enough — both could land in the same millisecond).
      const now = "2026-01-01T00:00:00.000Z";
      const job: Job = {
        id: testJobId,
        fileName: "test.mp3",
        status: "queued",
        error: null,
        title: null,
        createdAt: now,
        updatedAt: now,
      };

      await createJob(job);

      const updated = await updateJob(testJobId, {
        status: "done",
        title: "Pasta Carbonara",
      });

      expect(updated.status).toBe("done");
      expect(updated.title).toBe("Pasta Carbonara");
      expect(updated.updatedAt).not.toBe(now);
    });

    it("lists jobs sorted by createdAt descending", async () => {
      const now = new Date().toISOString();

      // Create first job
      const job1: Job = {
        id: testJobId,
        fileName: "test1.mp3",
        status: "done",
        error: null,
        title: "First",
        createdAt: now,
        updatedAt: now,
      };
      await createJob(job1);

      // Create second job with a later timestamp
      const job2Id = nanoid();
      const later = new Date(Date.now() + 1000).toISOString();
      const job2: Job = {
        id: job2Id,
        fileName: "test2.mp3",
        status: "done",
        error: null,
        title: "Second",
        createdAt: later,
        updatedAt: later,
      };
      await createJob(job2);

      try {
        const jobs = await listJobs();
        const found = jobs.filter((j) => j.id === testJobId || j.id === job2Id);

        expect(found).toHaveLength(2);
        expect(found[0].id).toBe(job2Id); // newer first
        expect(found[1].id).toBe(testJobId);
      } finally {
        await deleteJob(job2Id);
      }
    });

    it("deletes a job and its folder", async () => {
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
      const dir = jobDir(testJobId);
      expect(existsSync(dir)).toBe(true);

      await deleteJob(testJobId);
      expect(existsSync(dir)).toBe(false);
    });
  });

  describe("recipe versions", () => {
    beforeEach(async () => {
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
    });

    it("saves a version with correct numbering", async () => {
      const recipe: Recipe = {
        title: "Pasta",
        description: null,
        servings: null,
        totalTimeMinutes: null,
        ingredients: [],
        steps: [],
        tips: [],
        warnings: [],
      };

      const v1 = await saveVersion(testJobId, recipe, "extracted");
      expect(v1.meta.version).toBe(1);
      expect(v1.meta.source).toBe("extracted");
      expect(v1.recipe.title).toBe("Pasta");

      // Saving another version should increment
      const recipe2: Recipe = {
        ...recipe,
        title: "Pasta Carbonara",
      };
      const v2 = await saveVersion(testJobId, recipe2, "edited");
      expect(v2.meta.version).toBe(2);
      expect(v2.recipe.title).toBe("Pasta Carbonara");
    });

    it("saveVersion updates job.title", async () => {
      const recipe: Recipe = {
        title: "New Recipe Title",
        description: null,
        servings: null,
        totalTimeMinutes: null,
        ingredients: [],
        steps: [],
        tips: [],
        warnings: [],
      };

      await saveVersion(testJobId, recipe, "extracted");
      const job = await getJob(testJobId);

      expect(job?.title).toBe("New Recipe Title");
    });

    it("listVersions returns metadata in descending order", async () => {
      const recipe: Recipe = {
        title: "Pasta",
        description: null,
        servings: null,
        totalTimeMinutes: null,
        ingredients: [],
        steps: [],
        tips: [],
        warnings: [],
      };

      await saveVersion(testJobId, recipe, "extracted");
      await saveVersion(testJobId, recipe, "edited");
      await saveVersion(testJobId, recipe, "edited");

      const versions = await listVersions(testJobId);
      expect(versions).toHaveLength(3);
      expect(versions[0].version).toBe(3);
      expect(versions[1].version).toBe(2);
      expect(versions[2].version).toBe(1);
    });

    it("getVersion returns null for missing version", async () => {
      const recipe: Recipe = {
        title: "Pasta",
        description: null,
        servings: null,
        totalTimeMinutes: null,
        ingredients: [],
        steps: [],
        tips: [],
        warnings: [],
      };

      await saveVersion(testJobId, recipe, "extracted");
      const missing = await getVersion(testJobId, 999);

      expect(missing).toBeNull();
    });

    it("getLatestVersion returns the highest version", async () => {
      const recipe: Recipe = {
        title: "Pasta",
        description: null,
        servings: null,
        totalTimeMinutes: null,
        ingredients: [],
        steps: [],
        tips: [],
        warnings: [],
      };

      await saveVersion(testJobId, recipe, "extracted");
      const recipe2 = { ...recipe, title: "Edited Pasta" };
      await saveVersion(testJobId, recipe2, "edited");

      const latest = await getLatestVersion(testJobId);
      expect(latest?.meta.version).toBe(2);
      expect(latest?.recipe.title).toBe("Edited Pasta");
    });

    it("saveVersion with note includes the note in meta", async () => {
      const recipe: Recipe = {
        title: "Pasta",
        description: null,
        servings: null,
        totalTimeMinutes: null,
        ingredients: [],
        steps: [],
        tips: [],
        warnings: [],
      };

      await saveVersion(testJobId, recipe, "extracted");
      const v2 = await saveVersion(testJobId, recipe, "rollback", "Restored from v1");

      expect(v2.meta.note).toBe("Restored from v1");
      expect(v2.meta.source).toBe("rollback");
    });
  });
});
