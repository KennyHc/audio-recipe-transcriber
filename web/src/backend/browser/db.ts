// IndexedDB persistence for the browser backend, via `idb`. Mirrors the
// semantics of server/src/storage.ts (see that file for the file-based
// equivalent this is modeled on) but keyed in IndexedDB stores instead of
// data/<jobId>/ directories.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Job, Recipe, RecipeVersionMeta, Transcript, VersionedRecipe, VersionSource } from "@recipe/shared";
import { BROWSER_DB_NAME } from "../constants";

const DB_VERSION = 1;

interface AudioRecord {
  jobId: string;
  fileName: string;
  blob: Blob;
}

interface VersionRecord {
  jobId: string;
  version: number;
  versioned: VersionedRecipe;
}

interface RecipeTranscriberSchema extends DBSchema {
  jobs: {
    key: string;
    value: Job;
  };
  audio: {
    key: string; // jobId
    value: AudioRecord;
  };
  transcripts: {
    key: string; // jobId
    value: { jobId: string; transcript: Transcript };
  };
  versions: {
    key: [string, number]; // [jobId, version]
    value: VersionRecord;
    indexes: { byJob: string };
  };
}

let dbPromise: Promise<IDBPDatabase<RecipeTranscriberSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<RecipeTranscriberSchema>> {
  dbPromise ??= openDB<RecipeTranscriberSchema>(BROWSER_DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("jobs")) {
        db.createObjectStore("jobs", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("audio")) {
        db.createObjectStore("audio", { keyPath: "jobId" });
      }
      if (!db.objectStoreNames.contains("transcripts")) {
        db.createObjectStore("transcripts", { keyPath: "jobId" });
      }
      if (!db.objectStoreNames.contains("versions")) {
        const store = db.createObjectStore("versions", { keyPath: ["jobId", "version"] });
        store.createIndex("byJob", "jobId");
      }
    },
  });
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function createJob(job: Job): Promise<void> {
  const db = await getDb();
  await db.put("jobs", job);
}

export async function getJob(jobId: string): Promise<Job | null> {
  const db = await getDb();
  const job = await db.get("jobs", jobId);
  return job ?? null;
}

export async function saveJob(job: Job): Promise<void> {
  const db = await getDb();
  await db.put("jobs", job);
}

export async function updateJob(jobId: string, patch: Partial<Job>): Promise<Job> {
  const current = await getJob(jobId);
  if (!current) throw new Error(`Job ${jobId} not found`);
  const next: Job = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await saveJob(next);
  return next;
}

/** Newest first, matching server storage.listJobs(). */
export async function listJobs(): Promise<Job[]> {
  const db = await getDb();
  const jobs = await db.getAll("jobs");
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return jobs;
}

export async function deleteJobRecord(jobId: string): Promise<void> {
  const db = await getDb();
  // Look up the version keys to delete BEFORE opening the readwrite
  // transaction below: awaiting inside a transaction (across a microtask gap
  // not driven by that transaction's own requests) can let IndexedDB
  // auto-commit it early, which idb surfaces as a hang/TransactionInactiveError.
  const versionKeys = await db.getAllKeysFromIndex("versions", "byJob", jobId);

  const tx = db.transaction(["jobs", "audio", "transcripts", "versions"], "readwrite");
  await Promise.all([
    tx.objectStore("jobs").delete(jobId),
    tx.objectStore("audio").delete(jobId),
    tx.objectStore("transcripts").delete(jobId),
    ...versionKeys.map((key) => tx.objectStore("versions").delete(key)),
    tx.done,
  ]);
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export async function saveAudio(jobId: string, fileName: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put("audio", { jobId, fileName, blob });
}

export async function getAudio(jobId: string): Promise<AudioRecord | null> {
  const db = await getDb();
  const record = await db.get("audio", jobId);
  return record ?? null;
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export async function saveTranscript(jobId: string, transcript: Transcript): Promise<void> {
  const db = await getDb();
  await db.put("transcripts", { jobId, transcript });
}

export async function getTranscript(jobId: string): Promise<Transcript | null> {
  const db = await getDb();
  const record = await db.get("transcripts", jobId);
  return record?.transcript ?? null;
}

// ---------------------------------------------------------------------------
// Recipe versions
// ---------------------------------------------------------------------------

async function listVersionNumbers(db: IDBPDatabase<RecipeTranscriberSchema>, jobId: string): Promise<number[]> {
  const records = await db.getAllFromIndex("versions", "byJob", jobId);
  return records.map((r) => r.version);
}

/** Assigns the next version number, saves it, and syncs job.title — same
 * semantics as server storage.saveVersion(). */
export async function saveVersion(
  jobId: string,
  recipe: Recipe,
  source: VersionSource,
  note: string | null = null,
): Promise<VersionedRecipe> {
  const db = await getDb();
  const existing = await listVersionNumbers(db, jobId);
  const version = existing.length === 0 ? 1 : Math.max(...existing) + 1;
  const meta: RecipeVersionMeta = {
    version,
    source,
    createdAt: new Date().toISOString(),
    note,
  };
  const versioned: VersionedRecipe = { meta, recipe };
  await db.put("versions", { jobId, version, versioned });
  await updateJob(jobId, { title: recipe.title });
  return versioned;
}

/** Writes a version record exactly as given (preserving its number and meta), without
 * assigning a new version number or touching job.title — used by library restore to put
 * back a backed-up version verbatim. */
export async function putVersionRaw(jobId: string, versioned: VersionedRecipe): Promise<void> {
  const db = await getDb();
  await db.put("versions", { jobId, version: versioned.meta.version, versioned });
}

export async function listVersions(jobId: string): Promise<RecipeVersionMeta[]> {
  const db = await getDb();
  const records = await db.getAllFromIndex("versions", "byJob", jobId);
  const metas = records.map((r) => r.versioned.meta);
  metas.sort((a, b) => b.version - a.version);
  return metas;
}

export async function getVersion(jobId: string, version: number): Promise<VersionedRecipe | null> {
  const db = await getDb();
  const record = await db.get("versions", [jobId, version]);
  return record?.versioned ?? null;
}

export async function getLatestVersion(jobId: string): Promise<VersionedRecipe | null> {
  const db = await getDb();
  const numbers = await listVersionNumbers(db, jobId);
  if (numbers.length === 0) return null;
  return getVersion(jobId, Math.max(...numbers));
}

/** Test-only: closes the current connection (if any) and forces a fresh one
 * on the next getDb() call — needed so a following indexedDB.deleteDatabase()
 * doesn't block forever waiting for this connection to close. */
export async function _resetDbConnectionForTests(): Promise<void> {
  const previous = dbPromise;
  dbPromise = null;
  if (previous) {
    try {
      const db = await previous;
      db.close();
    } catch {
      // Connection never opened successfully — nothing to close.
    }
  }
}
