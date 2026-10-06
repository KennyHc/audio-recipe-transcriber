// Whole-library backup/restore for the in-browser modes (IndexedDB). Format: shared/backup.ts.
//
// Everything lives only in this browser's IndexedDB — clearing site data or switching browsers
// loses every recipe. exportLibrary() packages every job (with its transcript, every recipe
// version oldest-first, and optionally its audio) into one JSON file; importLibrary() reads
// one back in, skipping jobs that already exist locally.

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  LibraryBackup,
  type BackupJob,
  type Job,
  type VersionedRecipe,
} from "@recipe/shared";

// shared/backup.ts doesn't export a standalone `BackupAudio` type (only the schema value),
// so derive it from BackupJob's own `audio` field instead of re-deriving it from the schema.
type BackupAudio = NonNullable<BackupJob["audio"]>;
import * as db from "./db";

// ---------------------------------------------------------------------------
// base64 encode/decode, chunked so we never build one giant string with += in
// a single unbounded loop (that's quadratic — each += copies the whole string
// so far). Chunk size is a multiple of 3 so every chunk but the last encodes
// to base64 with no internal padding, and the per-chunk strings can simply be
// joined together into the final result.
// ---------------------------------------------------------------------------

const CHUNK_BYTES = 3 * 32_768; // 96 KB binary per chunk (multiple of 3)

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const slice = bytes.subarray(offset, offset + CHUNK_BYTES);
    let binary = "";
    for (let i = 0; i < slice.length; i++) binary += String.fromCharCode(slice[i]);
    chunks.push(btoa(binary));
  }
  return chunks.join("");
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = base64ToBytes(base64);
  return new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportLibrary(options: { includeAudio: boolean }): Promise<Blob> {
  const jobs = await db.listJobs();
  const backupJobs: BackupJob[] = [];

  for (const job of jobs) {
    const transcript = await db.getTranscript(job.id);

    const metas = await db.listVersions(job.id); // newest first
    const ascendingNumbers = metas.map((m) => m.version).sort((a, b) => a - b);
    const versions: VersionedRecipe[] = [];
    for (const version of ascendingNumbers) {
      const versioned = await db.getVersion(job.id, version);
      if (versioned) versions.push(versioned);
    }

    let audio: BackupAudio | null = null;
    if (options.includeAudio) {
      const record = await db.getAudio(job.id);
      if (record) {
        audio = {
          fileName: record.fileName,
          mimeType: record.blob.type || "application/octet-stream",
          base64: await blobToBase64(record.blob),
        };
      }
    }

    backupJobs.push({ job, transcript, versions, audio });
  }

  const backup: LibraryBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    jobs: backupJobs,
  };

  return new Blob([JSON.stringify(backup)], { type: "application/json" });
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const STATUSES_KEPT_AS_IS = new Set(["done", "error"]);

export async function importLibrary(file: File): Promise<{ imported: number; skipped: number }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error("This file isn't valid JSON — it doesn't look like a recipe library backup.");
  }

  if (typeof raw !== "object" || raw === null || (raw as Record<string, unknown>).format !== BACKUP_FORMAT) {
    throw new Error("This doesn't look like a recipe library backup file.");
  }

  const rawVersion = (raw as Record<string, unknown>).version;
  if (typeof rawVersion === "number" && rawVersion > BACKUP_VERSION) {
    throw new Error("This backup was made with a newer version of the app — update the app, then try restoring it again.");
  }

  const parsed = LibraryBackup.safeParse(raw);
  if (!parsed.success) {
    throw new Error("This backup file is corrupt or in an unexpected format.");
  }

  let imported = 0;
  let skipped = 0;

  for (const backupJob of parsed.data.jobs) {
    const existing = await db.getJob(backupJob.job.id);
    if (existing) {
      skipped++;
      continue;
    }

    const job: Job = STATUSES_KEPT_AS_IS.has(backupJob.job.status)
      ? backupJob.job
      : { ...backupJob.job, status: "error", error: "Imported while processing — press Retry." };

    await db.createJob(job);

    if (backupJob.transcript) {
      await db.saveTranscript(job.id, backupJob.transcript);
    }

    for (const versioned of backupJob.versions) {
      await db.putVersionRaw(job.id, versioned);
    }

    if (backupJob.audio) {
      await db.saveAudio(
        job.id,
        backupJob.audio.fileName,
        base64ToBlob(backupJob.audio.base64, backupJob.audio.mimeType),
      );
    }

    imported++;
  }

  return { imported, skipped };
}
