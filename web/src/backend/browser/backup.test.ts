import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtractedRecipe, Job, Recipe } from "@recipe/shared";
import { BACKUP_FORMAT, BACKUP_VERSION } from "@recipe/shared";
import * as db from "./db";
import { exportLibrary, importLibrary } from "./backup";

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

async function resetDb(): Promise<void> {
  await db._resetDbConnectionForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("recipe-transcriber");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function fakeFile(contents: Blob, name = "backup.json"): File {
  return new File([contents], name, { type: "application/json" });
}

afterEach(resetDb);

describe("exportLibrary / importLibrary round trip", () => {
  it("restores jobs, transcripts, every version, and audio", async () => {
    await db.createJob(job("j1", { status: "done", title: "Flour Mix" }));
    await db.saveTranscript("j1", { language: "en", segments: [{ start: 0, end: 2, text: "two cups of flour" }] });
    await db.saveVersion("j1", recipe("v1 title"), "extracted");
    await db.saveVersion("j1", recipe("v2 title"), "edited");
    const audioBlob = new Blob(["fake audio bytes, could be binary \u0000\u0001\u0002"], { type: "audio/mpeg" });
    await db.saveAudio("j1", "clip.mp3", audioBlob);

    const exported = await exportLibrary({ includeAudio: true });
    const parsedBackup = JSON.parse(await exported.text());
    expect(parsedBackup.format).toBe(BACKUP_FORMAT);
    expect(parsedBackup.version).toBe(BACKUP_VERSION);
    expect(parsedBackup.jobs).toHaveLength(1);
    expect(parsedBackup.jobs[0].versions.map((v: any) => v.meta.version)).toEqual([1, 2]);

    // Wipe the library clean, as if restoring into a fresh browser.
    await resetDb();
    expect(await db.listJobs()).toEqual([]);

    const result = await importLibrary(fakeFile(exported));
    expect(result).toEqual({ imported: 1, skipped: 0 });

    const restoredJob = await db.getJob("j1");
    expect(restoredJob?.status).toBe("done");
    // saveVersion syncs job.title to the most recently saved version's title.
    expect(restoredJob?.title).toBe("v2 title");

    const transcript = await db.getTranscript("j1");
    expect(transcript?.segments[0].text).toBe("two cups of flour");

    const versions = await db.listVersions("j1");
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    const v1 = await db.getVersion("j1", 1);
    expect(v1?.recipe.title).toBe("v1 title");
    const v2 = await db.getVersion("j1", 2);
    expect(v2?.recipe.title).toBe("v2 title");

    const restoredAudio = await db.getAudio("j1");
    expect(restoredAudio?.fileName).toBe("clip.mp3");
    expect(await restoredAudio?.blob.text()).toBe(await audioBlob.text());
  });

  it("omits audio when includeAudio is false", async () => {
    await db.createJob(job("j1", { status: "done" }));
    await db.saveAudio("j1", "clip.mp3", new Blob(["bytes"], { type: "audio/mpeg" }));
    await db.saveVersion("j1", recipe(), "extracted");

    const exported = await exportLibrary({ includeAudio: false });
    const parsedBackup = JSON.parse(await exported.text());
    expect(parsedBackup.jobs[0].audio).toBeNull();

    await resetDb();
    await importLibrary(fakeFile(exported));
    expect(await db.getAudio("j1")).toBeNull();
  });

  it("round-trips a job with no transcript yet (still queued)", async () => {
    await db.createJob(job("j1", { status: "queued" }));

    const exported = await exportLibrary({ includeAudio: false });
    await resetDb();
    const result = await importLibrary(fakeFile(exported));
    expect(result).toEqual({ imported: 1, skipped: 0 });

    const restored = await db.getJob("j1");
    // A non-terminal status is imported as an error asking the user to retry,
    // since the pipeline that was running it no longer exists in this browser.
    expect(restored?.status).toBe("error");
    expect(restored?.error).toMatch(/retry/i);
  });

  it("keeps a job that errored before import unchanged", async () => {
    await db.createJob(job("j1", { status: "error", error: "Something broke" }));

    const exported = await exportLibrary({ includeAudio: false });
    await resetDb();
    await importLibrary(fakeFile(exported));

    const restored = await db.getJob("j1");
    expect(restored?.status).toBe("error");
    expect(restored?.error).toBe("Something broke");
  });
});

describe("importLibrary: skip existing", () => {
  it("skips a job whose id already exists locally, without touching it", async () => {
    await db.createJob(job("j1", { status: "done", title: "Original" }));
    await db.saveVersion("j1", recipe("Original"), "extracted");

    const exported = await exportLibrary({ includeAudio: false });

    // Don't wipe this time — import into a library that already has j1 (perhaps edited since).
    await db.saveVersion("j1", recipe("Edited after export"), "edited");

    const result = await importLibrary(fakeFile(exported));
    expect(result).toEqual({ imported: 0, skipped: 1 });

    const latest = await db.getLatestVersion("j1");
    expect(latest?.recipe.title).toBe("Edited after export");
  });

  it("imports new jobs and skips existing ones in the same backup", async () => {
    await db.createJob(job("existing", { status: "done" }));
    await db.saveVersion("existing", recipe(), "extracted");

    await db.createJob(job("new-job", { status: "done" }));
    await db.saveVersion("new-job", recipe(), "extracted");

    const exported = await exportLibrary({ includeAudio: false });

    await db.deleteJobRecord("new-job");
    expect(await db.getJob("new-job")).toBeNull();

    const result = await importLibrary(fakeFile(exported));
    expect(result).toEqual({ imported: 1, skipped: 1 });
    expect(await db.getJob("new-job")).not.toBeNull();
  });
});

describe("importLibrary: rejects bad files", () => {
  it("rejects a file that isn't JSON", async () => {
    await expect(importLibrary(fakeFile(new Blob(["not json at all"])))).rejects.toThrow();
  });

  it("rejects JSON that isn't a backup at all", async () => {
    await expect(
      importLibrary(fakeFile(new Blob([JSON.stringify({ hello: "world" })]))),
    ).rejects.toThrow();
  });

  it("rejects a backup with a wrong format tag", async () => {
    const bad = { format: "something-else", version: 1, exportedAt: new Date().toISOString(), jobs: [] };
    await expect(importLibrary(fakeFile(new Blob([JSON.stringify(bad)])))).rejects.toThrow();
  });

  it("rejects a backup from a newer, unsupported version", async () => {
    const bad = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION + 1,
      exportedAt: new Date().toISOString(),
      jobs: [],
    };
    await expect(importLibrary(fakeFile(new Blob([JSON.stringify(bad)])))).rejects.toThrow(/newer/i);
  });

  it("rejects a corrupt backup (right format/version, invalid job shape)", async () => {
    const bad = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      jobs: [{ job: { id: "x" }, transcript: null, versions: [], audio: null }],
    };
    await expect(importLibrary(fakeFile(new Blob([JSON.stringify(bad)])))).rejects.toThrow();
  });
});
