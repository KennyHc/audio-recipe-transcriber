// File-based storage under <repoRoot>/data/<jobId>/. No database — see CLAUDE.md.
//
// Layout per job:
//   data/<jobId>/job.json            Job
//   data/<jobId>/audio.<ext>         original upload, as received
//   data/<jobId>/audio.wav           16kHz mono PCM, produced by ffmpeg
//   data/<jobId>/transcript.json     Transcript (normalised)
//   data/<jobId>/whisper.json        raw whisper-cli output, kept for debugging
//   data/<jobId>/recipes/v<N>.json   VersionedRecipe, N starting at 1

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Job, Recipe, RecipeVersionMeta, Transcript, VersionedRecipe, VersionSource } from "@recipe/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// server/src/storage.ts -> repo root is two levels up (server/src -> server -> repoRoot)
export const REPO_ROOT = path.resolve(__dirname, "../..");
// RECIPE_DATA_DIR lets tests use a throwaway folder instead of the real library.
export const DATA_ROOT = process.env.RECIPE_DATA_DIR ?? path.join(REPO_ROOT, "data");

export function jobDir(jobId: string): string {
  return path.join(DATA_ROOT, jobId);
}

function recipesDir(jobId: string): string {
  return path.join(jobDir(jobId), "recipes");
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  // Write to a temp file then rename, so a crash mid-write never leaves a
  // half-written job.json (which is polled by the web client every ~1s).
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(value, null, 2), "utf-8");
  await rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function createJob(job: Job): Promise<void> {
  await writeJson(path.join(jobDir(job.id), "job.json"), job);
}

export async function getJob(jobId: string): Promise<Job | null> {
  return readJson<Job>(path.join(jobDir(jobId), "job.json"));
}

export async function saveJob(job: Job): Promise<void> {
  await writeJson(path.join(jobDir(job.id), "job.json"), job);
}

export async function updateJob(jobId: string, patch: Partial<Job>): Promise<Job> {
  const current = await getJob(jobId);
  if (!current) throw new Error(`Job ${jobId} not found`);
  const next: Job = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await saveJob(next);
  return next;
}

export async function listJobs(): Promise<Job[]> {
  if (!existsSync(DATA_ROOT)) return [];
  const entries = await readdir(DATA_ROOT, { withFileTypes: true });
  const jobs: Job[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const job = await getJob(entry.name);
    if (job) jobs.push(job);
  }
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return jobs;
}

export async function deleteJob(jobId: string): Promise<void> {
  await rm(jobDir(jobId), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export function originalAudioPath(jobId: string, ext: string): string {
  return path.join(jobDir(jobId), `audio.${ext}`);
}

export function wavAudioPath(jobId: string): string {
  return path.join(jobDir(jobId), "audio.wav");
}

/** Finds the original uploaded audio file for a job, whatever its extension. */
export async function findOriginalAudio(jobId: string): Promise<string | null> {
  const dir = jobDir(jobId);
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir);
  const match = entries.find((name) => name.startsWith("audio.") && !name.endsWith(".wav"));
  return match ? path.join(dir, match) : null;
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export async function saveTranscript(jobId: string, transcript: Transcript): Promise<void> {
  await writeJson(path.join(jobDir(jobId), "transcript.json"), transcript);
}

export async function getTranscript(jobId: string): Promise<Transcript | null> {
  return readJson<Transcript>(path.join(jobDir(jobId), "transcript.json"));
}

export async function saveRawWhisperOutput(jobId: string, raw: unknown): Promise<void> {
  await writeJson(path.join(jobDir(jobId), "whisper.json"), raw);
}

// ---------------------------------------------------------------------------
// Recipe versions
// ---------------------------------------------------------------------------

function versionFilePath(jobId: string, version: number): string {
  return path.join(recipesDir(jobId), `v${version}.json`);
}

async function nextVersionNumber(jobId: string): Promise<number> {
  const versions = await listVersionNumbers(jobId);
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

async function listVersionNumbers(jobId: string): Promise<number[]> {
  const dir = recipesDir(jobId);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  return entries
    .map((name) => /^v(\d+)\.json$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
}

export async function saveVersion(
  jobId: string,
  recipe: Recipe,
  source: VersionSource,
  note: string | null = null,
): Promise<VersionedRecipe> {
  const version = await nextVersionNumber(jobId);
  const meta: RecipeVersionMeta = {
    version,
    source,
    createdAt: new Date().toISOString(),
    note,
  };
  const versioned: VersionedRecipe = { meta, recipe };
  await writeJson(versionFilePath(jobId, version), versioned);
  // Keep the library's title in sync with whatever is now the latest version.
  await updateJob(jobId, { title: recipe.title });
  return versioned;
}

export async function listVersions(jobId: string): Promise<RecipeVersionMeta[]> {
  const numbers = await listVersionNumbers(jobId);
  const metas: RecipeVersionMeta[] = [];
  for (const n of numbers) {
    const versioned = await readJson<VersionedRecipe>(versionFilePath(jobId, n));
    if (versioned) metas.push(versioned.meta);
  }
  metas.sort((a, b) => b.version - a.version);
  return metas;
}

export async function getVersion(jobId: string, version: number): Promise<VersionedRecipe | null> {
  return readJson<VersionedRecipe>(versionFilePath(jobId, version));
}

export async function getLatestVersion(jobId: string): Promise<VersionedRecipe | null> {
  const numbers = await listVersionNumbers(jobId);
  if (numbers.length === 0) return null;
  const latest = Math.max(...numbers);
  return getVersion(jobId, latest);
}
