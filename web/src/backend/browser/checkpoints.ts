// Per-job record of automatic transcription restarts (runner.ts): when a phone suspends the
// tab or the page reloads mid-transcription, the runner restarts the job by itself a few
// times, and this counter (which survives reloads) stops it looping. One record per job, in
// its own small IndexedDB database (CHECKPOINTS_DB_NAME). Every function swallows storage
// errors. (Mid-clip checkpoints of finished windows were tried and dropped — see transcribe.ts;
// the record keeps its original shape so existing databases stay readable.)

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { TranscriptSegment } from "@recipe/shared";
import { CHECKPOINTS_DB_NAME } from "../constants";

export interface TranscriptionCheckpoint {
  jobId: string;
  /** model::dtype::sampleCount — a checkpoint only applies to the same model and audio. */
  key: string;
  /** Samples [0, doneUntilSample) are transcribed. */
  doneUntilSample: number;
  /** Segments so far, in clip time (seconds). */
  segments: TranscriptSegment[];
  /** Automatic resumes after the tab was closed/reloaded mid-transcription (see runner.ts). */
  autoResumes: number;
  updatedAt: string;
}

interface CheckpointSchema extends DBSchema {
  checkpoints: { key: string; value: TranscriptionCheckpoint };
}

let dbPromise: Promise<IDBPDatabase<CheckpointSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<CheckpointSchema>> {
  dbPromise ??= openDB<CheckpointSchema>(CHECKPOINTS_DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("checkpoints")) db.createObjectStore("checkpoints", { keyPath: "jobId" });
    },
  }).catch((err: unknown) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

export async function getCheckpoint(jobId: string): Promise<TranscriptionCheckpoint | null> {
  try {
    return (await (await getDb()).get("checkpoints", jobId)) ?? null;
  } catch {
    return null;
  }
}

/** Counts one automatic resume; returns the new count. Creates a bare record if none exists. */
export async function noteAutoResume(jobId: string): Promise<number> {
  try {
    const db = await getDb();
    const prev = await db.get("checkpoints", jobId);
    const next: TranscriptionCheckpoint = prev
      ? { ...prev, autoResumes: prev.autoResumes + 1, updatedAt: new Date().toISOString() }
      : { jobId, key: "", doneUntilSample: 0, segments: [], autoResumes: 1, updatedAt: new Date().toISOString() };
    await db.put("checkpoints", next);
    return next.autoResumes;
  } catch {
    return Number.POSITIVE_INFINITY; // can't count → don't loop
  }
}

/** A manual Retry allows automatic restarts again. */
export async function resetAutoResumes(jobId: string): Promise<void> {
  try {
    const db = await getDb();
    const prev = await db.get("checkpoints", jobId);
    if (prev && prev.autoResumes !== 0) await db.put("checkpoints", { ...prev, autoResumes: 0 });
  } catch {
    /* best effort */
  }
}

export async function clearCheckpoint(jobId: string): Promise<void> {
  try {
    await (await getDb()).delete("checkpoints", jobId);
  } catch {
    /* best effort */
  }
}

/** "Delete all local data" / account deletion: drop the whole database. */
export async function deleteAllCheckpoints(): Promise<void> {
  const previous = dbPromise;
  dbPromise = null;
  try {
    (await previous)?.close();
  } catch {
    /* never opened */
  }
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(CHECKPOINTS_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
