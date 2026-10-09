import { describe, expect, it } from "vitest";
import { MAX_IMPORT_JOBS, type BackupJob, type Job } from "@recipe/shared";
import { buildClientVersionWrite, buildImportRequests, chunk, mergeJobs, recipeToJob, usageToQuota } from "./mapping";
import { cloudRecipe, recipe, usage, versioned } from "./testFixtures";

function localJob(id: string, status: Job["status"], createdAt: string): Job {
  return { id, fileName: `${id}.mp3`, status, error: status === "error" ? "boom" : null, title: null, createdAt, updatedAt: createdAt };
}

describe("recipeToJob", () => {
  it("maps an account recipe to a finished job", () => {
    expect(recipeToJob(cloudRecipe("r1", "Garlic noodles", "2026-10-05T00:00:00Z"))).toEqual({
      id: "r1",
      fileName: "r1.mp3",
      status: "done",
      error: null,
      title: "Garlic noodles",
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-05T00:00:00Z",
    });
  });
});

describe("mergeJobs", () => {
  it("puts this device's unfinished uploads first, then the account's recipes in query order", () => {
    const cloud = [cloudRecipe("b", "B", "2026-10-07T00:00:00Z"), cloudRecipe("a", "A", "2026-10-06T00:00:00Z")];
    const local = [localJob("old", "error", "2026-10-01T00:00:00Z"), localJob("new", "transcribing", "2026-10-08T00:00:00Z")];
    expect(mergeJobs(cloud, local).map((j) => [j.id, j.status])).toEqual([
      ["new", "transcribing"],
      ["old", "error"],
      ["b", "done"],
      ["a", "done"],
    ]);
  });

  it("drops a local job whose recipe already reached the account", () => {
    const merged = mergeJobs([cloudRecipe("x", "X", "2026-10-07T00:00:00Z")], [localJob("x", "extracting", "2026-10-07T00:00:00Z")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.status).toBe("done");
  });
});

describe("buildClientVersionWrite", () => {
  it("produces exactly the fields firestore.rules allows, as version currentVersion + 1", () => {
    const r = recipe("Edited title");
    const now = new Date("2026-10-08T12:00:00.000Z");
    const write = buildClientVersionWrite(3, r, "rollback", "Restored from v1", now);
    expect(write.versionId).toBe("4");
    // versions/{n}: keys hasOnly(['meta','recipe']); meta hasOnly(['version','source','createdAt','note'])
    expect(Object.keys(write.versioned).sort()).toEqual(["meta", "recipe"]);
    expect(Object.keys(write.versioned.meta).sort()).toEqual(["createdAt", "note", "source", "version"]);
    expect(write.versioned.meta).toEqual({ version: 4, source: "rollback", createdAt: now.toISOString(), note: "Restored from v1" });
    // recipes/{id}: affectedKeys hasOnly(['title','updatedAt','currentVersion','latest'])
    expect(Object.keys(write.recipeUpdate).sort()).toEqual(["currentVersion", "latest", "title", "updatedAt"]);
    expect(write.recipeUpdate.currentVersion).toBe(write.versioned.meta.version);
    expect(write.recipeUpdate.latest).toBe(write.versioned.recipe); // getAfter(...).data.recipe == latest
    expect(write.recipeUpdate.title).toBe(r.title); // title == latest.title
  });
});

describe("import requests", () => {
  function backupJob(id: string, versions = 1): BackupJob {
    return {
      job: localJob(id, "done", "2026-10-01T00:00:00Z"),
      transcript: null,
      versions: Array.from({ length: versions }, (_, i) => versioned(i + 1, id)),
      audio: { fileName: "a.mp3", mimeType: "audio/mpeg", base64: "AAAA" },
    };
  }

  it("splits into chunks of MAX_IMPORT_JOBS, strips audio, and leaves out jobs without versions", () => {
    const jobs = [...Array.from({ length: 120 }, (_, i) => backupJob(`j${i}`)), backupJob("empty", 0)];
    const { requests, withoutVersions } = buildImportRequests(jobs);
    expect(requests.map((r) => r.jobs.length)).toEqual([MAX_IMPORT_JOBS, MAX_IMPORT_JOBS, 20]);
    expect(requests.flatMap((r) => r.jobs).every((j) => j.audio === null)).toBe(true);
    expect(withoutVersions).toEqual(["empty"]);
  });

  it("chunk handles the edges", () => {
    expect(chunk([], 50)).toEqual([]);
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });
});

describe("usageToQuota", () => {
  it("maps GET /me usage to the Library's quota shape", () => {
    expect(usageToQuota(usage, new Date("2026-10-31T23:00:00.000Z"))).toEqual({ limit: 30, remaining: 25, resetsInSeconds: 3600 });
  });
});
