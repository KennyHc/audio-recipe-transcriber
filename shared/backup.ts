import { z } from "zod";
import { Job, VersionedRecipe } from "./api";
import { Transcript } from "./recipe";

// A whole-library backup file for the in-browser and hosted modes, whose data lives only in
// this browser's IndexedDB. Exported from Settings, imported back on any browser.

export const BACKUP_FORMAT = "recipe-transcriber-backup";
export const BACKUP_VERSION = 1;

export const BackupAudio = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  base64: z.string(),
});

export const BackupJob = z.object({
  job: Job,
  transcript: Transcript.nullable(),
  versions: z.array(VersionedRecipe), // every version, oldest first
  audio: BackupAudio.nullable(), // null when exported without audio
});
export type BackupJob = z.infer<typeof BackupJob>;

export const LibraryBackup = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string(), // ISO
  jobs: z.array(BackupJob),
});
export type LibraryBackup = z.infer<typeof LibraryBackup>;
