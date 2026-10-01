import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtractedRecipe, Job, Recipe } from "@recipe/shared";
import * as db from "./db";

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

function recipe(title = extracted.title): Recipe {
  return { ...extracted, title, warnings: [] };
}

function job(id: string, patch: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id,
    fileName: "clip.mp3",
    status: "queued",
    error: null,
    title: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

afterEach(async () => {
  // fake-indexeddb persists across tests in the same module registry unless
  // explicitly cleared; close the open connection (so delete isn't blocked)
  // and delete the database so each test starts fresh.
  await db._resetDbConnectionForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("recipe-transcriber");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

describe("jobs", () => {
  it("creates, reads, updates, and lists jobs newest first", async () => {
    await db.createJob(job("a", { createdAt: "2026-01-01T00:00:00.000Z" }));
    await db.createJob(job("b", { createdAt: "2026-01-02T00:00:00.000Z" }));
    await db.createJob(job("c", { createdAt: "2026-01-03T00:00:00.000Z" }));

    const jobs = await db.listJobs();
    expect(jobs.map((j) => j.id)).toEqual(["c", "b", "a"]);

    const updated = await db.updateJob("a", { status: "done", title: "New Title" });
    expect(updated.status).toBe("done");
    expect(updated.title).toBe("New Title");
    expect(await db.getJob("a")).toMatchObject({ status: "done", title: "New Title" });
  });

  it("returns null for a missing job", async () => {
    expect(await db.getJob("nope")).toBeNull();
  });

  it("throws when updating a job that doesn't exist", async () => {
    await expect(db.updateJob("missing", { status: "done" })).rejects.toThrow("not found");
  });
});

describe("recipe versions", () => {
  it("assigns sequential version numbers starting at 1 and syncs job.title", async () => {
    await db.createJob(job("j1"));

    const v1 = await db.saveVersion("j1", recipe("Title A"), "extracted");
    expect(v1.meta.version).toBe(1);
    expect(v1.meta.source).toBe("extracted");
    expect((await db.getJob("j1"))?.title).toBe("Title A");

    const v2 = await db.saveVersion("j1", recipe("Title B"), "edited");
    expect(v2.meta.version).toBe(2);
    expect((await db.getJob("j1"))?.title).toBe("Title B");

    const versions = await db.listVersions("j1");
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it("rollback copies an old version forward as a new version, never deleting history", async () => {
    await db.createJob(job("j2"));
    await db.saveVersion("j2", recipe("Title A"), "extracted");
    await db.saveVersion("j2", recipe("Title B"), "edited");

    const v1 = await db.getVersion("j2", 1);
    expect(v1).not.toBeNull();
    const rolledBack = await db.saveVersion("j2", v1!.recipe, "rollback", "Restored from v1");
    expect(rolledBack.meta.version).toBe(3);
    expect(rolledBack.meta.source).toBe("rollback");
    expect(rolledBack.meta.note).toBe("Restored from v1");
    expect(rolledBack.recipe.title).toBe("Title A");

    // All three versions still exist.
    const versions = await db.listVersions("j2");
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect((await db.getJob("j2"))?.title).toBe("Title A");
  });

  it("getLatestVersion returns the highest version number", async () => {
    await db.createJob(job("j3"));
    expect(await db.getLatestVersion("j3")).toBeNull();
    await db.saveVersion("j3", recipe("v1"), "extracted");
    await db.saveVersion("j3", recipe("v2"), "edited");
    const latest = await db.getLatestVersion("j3");
    expect(latest?.meta.version).toBe(2);
    expect(latest?.recipe.title).toBe("v2");
  });
});

describe("audio + transcript", () => {
  it("stores and retrieves audio blobs and transcripts", async () => {
    await db.createJob(job("j4"));
    const blob = new Blob(["fake audio bytes"], { type: "audio/mpeg" });
    await db.saveAudio("j4", "clip.mp3", blob);
    const audio = await db.getAudio("j4");
    expect(audio?.fileName).toBe("clip.mp3");
    expect(await audio?.blob.text()).toBe("fake audio bytes");

    expect(await db.getTranscript("j4")).toBeNull();
    await db.saveTranscript("j4", { language: "en", segments: [{ start: 0, end: 1, text: "hi" }] });
    expect(await db.getTranscript("j4")).toEqual({ language: "en", segments: [{ start: 0, end: 1, text: "hi" }] });
  });
});

describe("deleteJobRecord", () => {
  it("removes the job, its audio, transcript, and all recipe versions", async () => {
    await db.createJob(job("j5"));
    await db.saveAudio("j5", "clip.mp3", new Blob(["x"]));
    await db.saveTranscript("j5", { language: null, segments: [] });
    await db.saveVersion("j5", recipe(), "extracted");
    await db.saveVersion("j5", recipe(), "edited");

    await db.deleteJobRecord("j5");

    expect(await db.getJob("j5")).toBeNull();
    expect(await db.getAudio("j5")).toBeNull();
    expect(await db.getTranscript("j5")).toBeNull();
    expect(await db.listVersions("j5")).toEqual([]);
  });

  it("does not disturb other jobs' data", async () => {
    await db.createJob(job("keep"));
    await db.saveVersion("keep", recipe(), "extracted");
    await db.createJob(job("gone"));
    await db.saveVersion("gone", recipe(), "extracted");

    await db.deleteJobRecord("gone");

    expect(await db.getJob("keep")).not.toBeNull();
    expect(await db.getLatestVersion("keep")).not.toBeNull();
  });
});
