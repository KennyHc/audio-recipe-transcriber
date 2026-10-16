import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKUP_FORMAT, BACKUP_VERSION, type CloudRecipe, type Job, type MeResponse, type VersionedRecipe } from "@recipe/shared";
import * as db from "../browser/db";
import * as runner from "../browser/runner";
import { createCaptionsJob } from "../browser";
import { transcribeAudio } from "../browser/transcribe";
import { isModelCached } from "../browser/modelCatalog";
import { ensureModelDownloaded } from "../browser/modelDownloader";
import { AudioNotOnDeviceError, type Backend } from "../types";
import { createCloudBackend, type UsageCache } from "./backend";
import type { ApiClient } from "./api";
import type { RecipeStore } from "./store";
import { CloudApiError } from "./errors";
import { clearLocalJobOwners, localJobOwner, localJobSourceUrl, markLocalJob } from "./localJobs";
import { moveLegacyJobs, listLegacyJobs } from "./legacy";
import { cloudRecipe, transcript, usage, versioned } from "./testFixtures";

// Only the expensive leaves are mocked (Whisper, Claude, model cache/downloader); the runner and
// IndexedDB (fake-indexeddb) are real. Firebase is replaced by the injected store/api fakes.
vi.mock("../browser/transcribe", () => ({ transcribeAudio: vi.fn() }));
vi.mock("../browser/claude", () => ({
  extractRecipe: vi.fn(),
  verifyRecipe: vi.fn(),
  ExtractionError: class extends Error {},
  VerificationError: class extends Error {},
}));
vi.mock("../browser/modelCatalog", () => ({ isModelCached: vi.fn() }));
vi.mock("../browser/modelDownloader", () => ({ ensureModelDownloaded: vi.fn() }));

const UID = "alice";

function fakeStore(initial: CloudRecipe[] = []) {
  const recipes = new Map(initial.map((r) => [r.id, r]));
  const versions = new Map<string, VersionedRecipe[]>();
  const store: RecipeStore & { recipes: typeof recipes } = {
    recipes,
    listRecipes: vi.fn(async () => [...recipes.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
    getRecipe: vi.fn(async (id: string) => {
      const r = recipes.get(id);
      if (!r) throw new Error("Recipe not found.");
      return r;
    }),
    noteRecipe: vi.fn((_uid: string, r: CloudRecipe) => void recipes.set(r.id, r)),
    getVersion: vi.fn(async (id: string, n: number) => {
      const v = versions.get(id)?.find((x) => x.meta.version === n);
      if (!v) throw new Error(`Version ${n} not found.`);
      return v;
    }),
    listVersions: vi.fn(async (id: string) => versions.get(id) ?? []),
    saveClientVersion: vi.fn(async (id, recipe, source, note) => {
      const r = recipes.get(id)!;
      const v: VersionedRecipe = { meta: { version: r.currentVersion + 1, source, createdAt: "now", note }, recipe };
      recipes.set(id, { ...r, currentVersion: v.meta.version, latest: recipe, title: recipe.title });
      versions.set(id, [...(versions.get(id) ?? []), v]);
      return v;
    }),
    getTranscript: vi.fn(async () => transcript),
    putTranscript: vi.fn(async () => undefined),
    deleteRecipe: vi.fn(async (id: string) => recipes.delete(id)),
    reset: vi.fn(),
  };
  return { store, versions };
}

function fakeApi(): ApiClient & { [K in keyof ApiClient]: ReturnType<typeof vi.fn> } {
  return {
    createRecipe: vi.fn(async (body) => ({
      recipe: { ...cloudRecipe(body.id, "From the API", "2026-10-08T12:00:00.000Z"), fileName: body.fileName },
      version: versioned(1, "From the API"),
      usage,
    })),
    reextract: vi.fn(async (id: string) => ({
      recipe: cloudRecipe(id, "Re-extracted", "2026-10-08T13:00:00.000Z", 3),
      version: versioned(3, "Re-extracted", "reextracted"),
      usage: { ...usage, used: 6, remaining: 24 },
    })),
    importJobs: vi.fn(async (body) => ({ imported: body.jobs.map((j: { job: Job }) => j.job.id), skipped: [] })),
    getMe: vi.fn(async (): Promise<MeResponse> => ({ uid: UID, email: "a@example.com", plan: "free", handle: null, isAdmin: false, usage })),
    deleteMe: vi.fn(async () => undefined),
  } as never;
}

function usageCache(): UsageCache & { last: MeResponse | null } {
  const c = {
    last: null as MeResponse | null,
    get: () => c.last,
    set: (me: MeResponse) => void (c.last = me),
    setUsage: vi.fn(),
  };
  return c;
}

let store: ReturnType<typeof fakeStore>["store"];
let versions: ReturnType<typeof fakeStore>["versions"];
let api: ReturnType<typeof fakeApi>;
let backend: Backend;
let signedIn: string | null;

async function seedLocalJob(id: string, patch: Partial<Job> = {}, owner: string | null = UID): Promise<void> {
  const now = new Date().toISOString();
  await db.createJob({ id, fileName: `${id}.mp3`, status: "queued", error: null, title: null, createdAt: now, updatedAt: now, ...patch });
  if (owner) markLocalJob(id, owner);
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  ({ store, versions } = fakeStore([
    cloudRecipe("cloud-old", "Old soup", "2026-10-02T00:00:00.000Z"),
    cloudRecipe("cloud-new", "New stew", "2026-10-06T00:00:00.000Z", 2),
  ]));
  versions.set("cloud-new", [versioned(1, "New stew"), versioned(2, "New stew v2", "edited")]);
  api = fakeApi();
  signedIn = UID;
  vi.mocked(transcribeAudio).mockResolvedValue(transcript);
  vi.mocked(isModelCached).mockResolvedValue(true);
  vi.mocked(ensureModelDownloaded).mockResolvedValue(undefined);
  backend = createCloudBackend({
    session: {
      requireUid: async () => {
        if (!signedIn) throw new Error("Sign in to continue.");
        return signedIn;
      },
      currentUid: () => signedIn,
    },
    store,
    api,
    usage: usageCache(),
    local: {
      // The real browser upload reads the file with FileReader (not in Node); this does the same
      // storage + pipeline start.
      uploadAudio: (file: File) => ({
        promise: (async () => {
          const id = `upload-${Math.random().toString(36).slice(2, 10)}`;
          const now = new Date().toISOString();
          await db.createJob({ id, fileName: file.name, status: "queued", error: null, title: null, createdAt: now, updatedAt: now });
          await db.saveAudio(id, file.name, new Blob(["audio"]));
          await runner.startPipeline(id);
          return (await db.getJob(id))!;
        })(),
        cancel: () => undefined,
      }),
      createFromCaptions: createCaptionsJob,
      getProgress: (id) => runner.getProgress(id),
      resumeAfterModelConsent: async (id) => (await db.getJob(id))!,
    },
  });
});

afterEach(async () => {
  runner.setFinishStep(null);
  vi.resetAllMocks();
  clearLocalJobOwners();
  await db._resetDbConnectionForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("recipe-transcriber");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe("upload → transcribe → POST /recipes", () => {
  it("sends the transcript to the API, then keeps only the audio locally", async () => {
    const job = await backend.uploadAudio(new File(["x"], "pasta.mp3"), () => undefined).promise;
    expect(localJobOwner(job.id)).toBe(UID);

    const done = await waitFor(async () => {
      const j = await backend.getJob(job.id);
      return j.status === "done" ? j : null;
    });
    expect(done.title).toBe("From the API");
    expect(api.createRecipe).toHaveBeenCalledWith({ id: job.id, fileName: "pasta.mp3", transcript });
    expect(await db.getJob(job.id)).toBeNull();
    expect(await db.getTranscript(job.id)).toBeNull();
    expect(await db.getAudio(job.id)).not.toBeNull(); // click-to-hear on this device
    expect(localJobOwner(job.id)).toBeNull();
    expect(await backend.getAudioUrl(job.id)).toMatch(/^blob:/);
  });

  it("on failure keeps the job + transcript locally with the friendly message; Retry re-POSTs without transcribing", async () => {
    api.createRecipe.mockRejectedValueOnce(
      new CloudApiError("quota_exceeded", "You've used your 30 free recipes this month. They reset on November 1.", 429),
    );
    const job = await backend.uploadAudio(new File(["x"], "pasta.mp3"), () => undefined).promise;
    const failed = await waitFor(async () => {
      const j = await backend.getJob(job.id);
      return j.status === "error" ? j : null;
    });
    expect(failed.error).toBe("You've used your 30 free recipes this month. They reset on November 1.");
    expect(await db.getTranscript(job.id)).toEqual(transcript);
    expect((await backend.listJobs()).find((j) => j.id === job.id)?.status).toBe("error");

    vi.mocked(transcribeAudio).mockClear();
    await backend.retry(job.id);
    await waitFor(async () => (await backend.getJob(job.id)).status === "done");
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(api.createRecipe).toHaveBeenCalledTimes(2);
  });

  it("carries the video link entered at upload into POST /recipes (sourceUrl), then forgets it", async () => {
    const url = "https://www.youtube.com/watch?v=qH__o17xHls";
    const job = await backend.uploadAudio(new File(["x"], "pasta.mp3"), () => undefined, { sourceUrl: url }).promise;
    // (No check of the stored link here: the fake pipeline can finish — and forget it —
    // before this line runs. The POST body below proves it was carried through.)
    await waitFor(async () => (await backend.getJob(job.id)).status === "done");
    expect(api.createRecipe).toHaveBeenCalledWith({ id: job.id, fileName: "pasta.mp3", transcript, sourceUrl: url });
    expect(localJobSourceUrl(job.id)).toBeNull();
  });

  it("keeps the video link across a failed POST, so Retry still sends it", async () => {
    const url = "https://www.tiktok.com/@cook/video/7234567890123456789";
    api.createRecipe.mockRejectedValueOnce(new CloudApiError("budget_exhausted", "Try again tomorrow.", 503));
    const job = await backend.uploadAudio(new File(["x"], "pasta.mp3"), () => undefined, { sourceUrl: url }).promise;
    await waitFor(async () => (await backend.getJob(job.id)).status === "error");
    expect(localJobSourceUrl(job.id)).toBe(url);
    await backend.retry(job.id);
    await waitFor(async () => (await backend.getJob(job.id)).status === "done");
    expect(api.createRecipe).toHaveBeenLastCalledWith({ id: job.id, fileName: "pasta.mp3", transcript, sourceUrl: url });
  });

  it("sends no sourceUrl when the link was left empty", async () => {
    const job = await backend.uploadAudio(new File(["x"], "pasta.mp3"), () => undefined, { sourceUrl: null }).promise;
    await waitFor(async () => (await backend.getJob(job.id)).status === "done");
    expect(api.createRecipe.mock.calls[0][0]).not.toHaveProperty("sourceUrl");
  });

  it("refuses to upload while signed out", async () => {
    signedIn = null;
    await expect(backend.uploadAudio(new File(["x"], "a.mp3"), () => undefined).promise).rejects.toThrow(/Sign in/);
  });
});

describe("captions → POST /recipes (no audio, no Whisper)", () => {
  const captions = "0:00\nToday, egg fried rice\n0:05\nBeat two eggs\n0:12\nFry the rice in hot oil";

  it("sends the parsed transcript with the video link and a captions file name; nothing is transcribed", async () => {
    const url = "https://www.youtube.com/watch?v=qH__o17xHls";
    const job = await backend.createFromCaptions({ text: captions }, { sourceUrl: url });
    expect(job.fileName).toBe("Pasted captions");
    await waitFor(async () => (await backend.getJob(job.id)).status === "done");
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(isModelCached).not.toHaveBeenCalled();
    const body = api.createRecipe.mock.calls[0][0];
    expect(body).toMatchObject({ id: job.id, fileName: "Pasted captions", sourceUrl: url });
    expect(body.transcript.segments.map((s: { start: number }) => s.start)).toEqual([0, 5, 12]);
    expect(localJobSourceUrl(job.id)).toBeNull();
    expect(await db.getAudio(job.id)).toBeNull();
  });

  it("uses the caption file's name, and sends untimed plain text as-is (the API strips timestamps)", async () => {
    const job = await backend.createFromCaptions({ text: "Beat two eggs. Fry the rice.", fileName: "fried-rice.txt" });
    await waitFor(async () => (await backend.getJob(job.id)).status === "done");
    const body = api.createRecipe.mock.calls[0][0];
    expect(body.fileName).toBe("fried-rice.txt");
    expect(body.transcript.segments.every((s: { start: number; end: number }) => s.start === 0 && s.end === 0)).toBe(true);
    expect(body).not.toHaveProperty("sourceUrl");
  });

  it("Retry after a failed POST re-sends the captions (there's no audio to re-transcribe)", async () => {
    api.createRecipe.mockRejectedValueOnce(new CloudApiError("budget_exhausted", "Try again tomorrow.", 503));
    const job = await backend.createFromCaptions({ text: captions }, { sourceUrl: "https://youtu.be/qH__o17xHls" });
    await waitFor(async () => (await backend.getJob(job.id)).status === "error");
    await backend.retry(job.id);
    await waitFor(async () => (await backend.getJob(job.id)).status === "done");
    expect(api.createRecipe).toHaveBeenCalledTimes(2);
    expect(api.createRecipe.mock.calls[1][0].sourceUrl).toBe("https://youtu.be/qH__o17xHls");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("refuses unusable text and signed-out visitors, creating nothing", async () => {
    await expect(backend.createFromCaptions({ text: "  " })).rejects.toThrow(/Paste the video's transcript/);
    signedIn = null;
    await expect(backend.createFromCaptions({ text: captions })).rejects.toThrow(/Sign in/);
    expect(await db.listJobs()).toEqual([]);
  });

  it("never sends another account's pending upload under this one", async () => {
    const job = await backend.createFromCaptions({ text: captions });
    await waitFor(async () => (await backend.getJob(job.id)).status === "done");
    api.createRecipe.mockClear();
    // A pending job owned by someone else on this device.
    await seedLocalJob("bobs-job", { status: "error" }, "bob");
    await db.saveTranscript("bobs-job", transcript);
    await runner.runReextract("bobs-job");
    await waitFor(async () => (await db.getJob("bobs-job"))?.status === "error");
    expect((await db.getJob("bobs-job"))?.error).toMatch(/another account/);
    expect(api.createRecipe).not.toHaveBeenCalled();
  });
});

describe("listJobs", () => {
  it("merges this user's unfinished local jobs with the account's recipes, hiding the old local library and other users' uploads", async () => {
    await seedLocalJob("mine-pending", { status: "error", error: "x" });
    await seedLocalJob("someone-elses", { status: "error" }, "bob");
    await seedLocalJob("legacy-done", { status: "done", title: "Old local" }, null);
    const jobs = await backend.listJobs();
    expect(jobs.map((j) => j.id)).toEqual(["mine-pending", "cloud-new", "cloud-old"]);
  });

  it("throws while signed out", async () => {
    signedIn = null;
    await expect(backend.listJobs()).rejects.toThrow("Sign in to continue.");
  });
});

describe("recipes, versions, edits", () => {
  it("getRecipe reads versions/{currentVersion}", async () => {
    const vr = await backend.getRecipe("cloud-new");
    expect(vr.meta.version).toBe(2);
    expect(store.getVersion).toHaveBeenCalledWith("cloud-new", 2);
  });

  it("putRecipe saves an 'edited' version; rollback saves 'rollback' with the browser backend's note", async () => {
    const edited = await backend.putRecipe("cloud-new", versioned(1, "Better stew").recipe);
    expect(edited.meta).toMatchObject({ version: 3, source: "edited", note: null });
    const rolled = await backend.rollback("cloud-new", 1);
    expect(rolled.meta).toMatchObject({ version: 4, source: "rollback", note: "Restored from v1" });
    expect(store.saveClientVersion).toHaveBeenLastCalledWith("cloud-new", versioned(1, "New stew").recipe, "rollback", "Restored from v1");
  });

  it("listVersions is newest first", async () => {
    expect((await backend.listVersions("cloud-new")).map((m) => m.version)).toEqual([2, 1]);
  });

  it("reextract on an account recipe calls the API and returns the finished job", async () => {
    const job = await backend.reextract("cloud-new");
    expect(api.reextract).toHaveBeenCalledWith("cloud-new");
    expect(job).toMatchObject({ status: "done", title: "Re-extracted" });
  });

  it("a failed reextract leaves the recipe as it was (error thrown, not stored)", async () => {
    api.reextract.mockRejectedValueOnce(new CloudApiError("budget_exhausted", "daily limit", 503));
    await expect(backend.reextract("cloud-new")).rejects.toThrow("daily limit");
    expect((await backend.getJob("cloud-new")).status).toBe("done");
  });

  it("putTranscript writes the account transcript for account recipes", async () => {
    await backend.putTranscript("cloud-new", transcript);
    expect(store.putTranscript).toHaveBeenCalledWith("cloud-new", transcript);
  });
});

describe("audio and delete", () => {
  it("getAudioUrl throws AudioNotOnDeviceError when this device doesn't have the audio", async () => {
    await expect(backend.getAudioUrl("cloud-new")).rejects.toBeInstanceOf(AudioNotOnDeviceError);
  });

  it("deleteJob deletes the account recipe and the local audio", async () => {
    await db.saveAudio("cloud-new", "a.mp3", new Blob(["a"]));
    await backend.deleteJob("cloud-new");
    expect(store.deleteRecipe).toHaveBeenCalledWith("cloud-new");
    expect(await db.getAudio("cloud-new")).toBeNull();
  });
});

describe("quota, export, import", () => {
  it("getQuota maps GET /me usage", async () => {
    const q = await backend.getQuota();
    expect(q).toMatchObject({ limit: 30, remaining: 25 });
  });

  it("getQuota is null when the API fails", async () => {
    api.getMe.mockRejectedValueOnce(new Error("down"));
    expect(await backend.getQuota()).toBeNull();
  });

  it("exportLibrary writes the account in the LibraryBackup format", async () => {
    const blob = await backend.exportLibrary({ includeAudio: false });
    const parsed = JSON.parse(await blob.text());
    expect(parsed.format).toBe(BACKUP_FORMAT);
    expect(parsed.jobs.map((j: { job: Job }) => j.job.id)).toEqual(["cloud-new", "cloud-old"]);
    expect(parsed.jobs[0].versions).toHaveLength(2);
    expect(parsed.jobs[0].audio).toBeNull();
  });

  it("importLibrary POSTs in chunks with audio stripped, keeping any audio locally", async () => {
    const jobs = Array.from({ length: 51 }, (_, i) => ({
      job: { id: `imp-${i}`, fileName: "a.mp3", status: "done", error: null, title: "T", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
      transcript: null,
      versions: [versioned(1, "T")],
      audio: i === 0 ? { fileName: "a.mp3", mimeType: "audio/mpeg", base64: "AAAA" } : null,
    }));
    const file = new File([JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: "x", jobs })], "b.json");
    const result = await backend.importLibrary(file);
    expect(result).toEqual({ imported: 51, skipped: 0 });
    expect(api.importJobs).toHaveBeenCalledTimes(2);
    expect(api.importJobs.mock.calls[0]![0].jobs).toHaveLength(50);
    expect(api.importJobs.mock.calls[0]![0].jobs[0].audio).toBeNull();
    expect(await db.getAudio("imp-0")).not.toBeNull();
  });
});

describe("moving the old local library", () => {
  it("imports finished legacy jobs and removes their records but keeps audio; skipped ids are only dropped if in the account", async () => {
    await seedLocalJob("legacy-a", { status: "done", title: "A" }, null);
    await db.putVersionRaw("legacy-a", versioned(1, "A"));
    await db.saveAudio("legacy-a", "a.mp3", new Blob(["a"]));
    await seedLocalJob("legacy-b", { status: "done", title: "B" }, null);
    await db.putVersionRaw("legacy-b", versioned(1, "B"));
    await seedLocalJob("pending", { status: "transcribing" }); // a signed-in upload: never moved
    expect((await listLegacyJobs()).map((j) => j.id).sort()).toEqual(["legacy-a", "legacy-b"]);

    api.importJobs.mockResolvedValueOnce({ imported: ["legacy-a"], skipped: ["legacy-b"] });
    const result = await moveLegacyJobs({ api, isInAccount: async () => false });

    expect(result).toEqual({ imported: 1, skipped: 1 });
    expect(api.importJobs.mock.calls[0]![0].jobs.map((j: { job: Job }) => j.job.id).sort()).toEqual(["legacy-a", "legacy-b"]);
    expect(await db.getJob("legacy-a")).toBeNull();
    expect(await db.getAudio("legacy-a")).not.toBeNull();
    expect(await db.getJob("legacy-b")).not.toBeNull(); // skipped and not ours: keep it
    expect(await db.getJob("pending")).not.toBeNull();
  });
});
