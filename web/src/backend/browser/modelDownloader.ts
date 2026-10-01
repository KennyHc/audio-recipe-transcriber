// Resumable, chunked pre-download of transformers.js's model files into its own Cache
// Storage entries.
//
// The problem: transformers.js's hub.js only calls `cache.put()` once a file's response has
// been read to completion (see modelCatalog.ts's doc comment on remainingBytesToDownload) —
// so on a large model (large-v3-turbo q4 is ~762 MB, dominated by one or two ~300-400 MB onnx
// files), any interruption mid-file (reload, laptop sleep, Wi-Fi drop) throws the whole file
// away, even if 95% of it had downloaded.
//
// The fix: before transformers.js ever sees these files, we range-fetch each one (see
// modelCatalog.modelFilesWithUrls) in fixed-size chunks, storing each completed chunk in a
// dedicated IndexedDB database (MODEL_CHUNKS_DB_NAME — kept separate from the app's own data
// DB) as soon as it lands. If interrupted, only the one in-flight chunk (at most CHUNK_SIZE
// bytes) is lost; the next attempt resumes from whatever chunks already exist. Once every
// chunk for a file is present, they're streamed back out in order and handed to
// `cache.put()` under the *exact* URL transformers.js uses as its own cache key (verified
// against node_modules/@huggingface/transformers/src/utils/hub.js's buildResourcePaths: the
// browser Cache API's proposedCacheKey is the plain remoteURL) — so transformers.js's own
// pipeline() load never knows this happened; it just finds the file already cached.
//
// Range support through Hugging Face's `resolve/main/...` redirect (which lands on a
// cross-origin CDN) was verified against a real browser fetch: a Range request against the
// `resolve/main/` URL directly returns 206 with a correct Content-Range after the redirect,
// so we range against that URL rather than pre-resolving the CDN URL ourselves.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { MODEL_CHUNKS_DB_NAME } from "../constants";
import { modelFilesWithUrls, TRANSFORMERS_CACHE_NAME } from "./modelCatalog";
import {
  aggregateBytes,
  estimateEtaSeconds,
  estimateRateBytesPerSec,
  formatDownloadLabel,
  formatMB,
  pushRateSample,
  shouldEmitProgressUpdate,
  type FileBytesProgress,
  type RateSample,
} from "@/lib/downloadProgress";

const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB
const MAX_PARALLEL_CHUNKS = 3;
const MAX_CHUNK_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 300;
const PROGRESS_THROTTLE_MS = 200;
const DB_VERSION = 1;

export class InsufficientStorageError extends Error {}

// ---------------------------------------------------------------------------
// IndexedDB: chunk + per-file metadata storage
// ---------------------------------------------------------------------------

interface ChunkRecord {
  url: string;
  chunkIndex: number;
  bytes: ArrayBuffer;
}

interface FileMetaRecord {
  url: string;
  totalBytes: number;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  chunkSize: number;
  chunkCount: number;
}

interface ModelChunksSchema extends DBSchema {
  chunks: {
    key: [string, number];
    value: ChunkRecord;
    indexes: { byUrl: string };
  };
  fileMeta: {
    key: string;
    value: FileMetaRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<ModelChunksSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<ModelChunksSchema>> {
  dbPromise ??= openDB<ModelChunksSchema>(MODEL_CHUNKS_DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("chunks")) {
        const store = db.createObjectStore("chunks", { keyPath: ["url", "chunkIndex"] });
        store.createIndex("byUrl", "url");
      }
      if (!db.objectStoreNames.contains("fileMeta")) {
        db.createObjectStore("fileMeta", { keyPath: "url" });
      }
    },
  });
  return dbPromise;
}

async function getFileMeta(url: string): Promise<FileMetaRecord | null> {
  const db = await getDb();
  return (await db.get("fileMeta", url)) ?? null;
}

async function putFileMeta(meta: FileMetaRecord): Promise<void> {
  const db = await getDb();
  await db.put("fileMeta", meta);
}

async function deleteFileMeta(url: string): Promise<void> {
  const db = await getDb();
  await db.delete("fileMeta", url);
}

async function getChunk(url: string, chunkIndex: number): Promise<ChunkRecord | undefined> {
  const db = await getDb();
  return db.get("chunks", [url, chunkIndex]);
}

async function putChunk(url: string, chunkIndex: number, bytes: ArrayBuffer): Promise<void> {
  const db = await getDb();
  await db.put("chunks", { url, chunkIndex, bytes });
}

async function listChunkIndexes(url: string): Promise<Set<number>> {
  const db = await getDb();
  const keys = await db.getAllKeysFromIndex("chunks", "byUrl", url);
  return new Set(keys.map((k) => k[1]));
}

async function deleteChunksForUrl(url: string): Promise<void> {
  const db = await getDb();
  const keys = await db.getAllKeysFromIndex("chunks", "byUrl", url);
  const tx = db.transaction("chunks", "readwrite");
  await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
}

async function deleteChunk(url: string, chunkIndex: number): Promise<void> {
  const db = await getDb();
  await db.delete("chunks", [url, chunkIndex]);
}

async function sumStoredChunkBytes(url: string): Promise<number> {
  const db = await getDb();
  const records = await db.getAllFromIndex("chunks", "byUrl", url);
  return records.reduce((total, r) => total + r.bytes.byteLength, 0);
}

async function closeDb(): Promise<void> {
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

/** Deletes the entire chunks database — used by Settings' "Delete all local data" alongside
 * clearing the app's own data DB and the transformers-cache Cache Storage entries. Safe to
 * call even if a download is in flight in this tab (the in-flight download will simply start
 * failing to read/write chunks and surface an error, same as any other storage failure). */
export async function deleteAllModelChunks(): Promise<void> {
  await closeDb();
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(MODEL_CHUNKS_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Failed to delete the model-chunks database"));
    req.onblocked = () => resolve(); // will complete once other connections close
  });
}

/** Test-only: mirrors db.ts's _resetDbConnectionForTests, needed before a following
 * indexedDB.deleteDatabase() call in tests (idb keeps a live connection otherwise). */
export async function _resetDbConnectionForTests(): Promise<void> {
  await closeDb();
}

// ---------------------------------------------------------------------------
// Storage budget
// ---------------------------------------------------------------------------

async function persistStorageBestEffort(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Best-effort only — persistence isn't required for correctness, just durability.
  }
}

/** Fails early with a clear message if there isn't room for the remaining bytes plus one
 * extra copy of the largest pending file (chunks-on-disk + the final cached copy briefly
 * coexist while a file is being assembled — see downloadFile's cache.put before
 * deleteChunksForUrl). Fails open (does nothing) if `navigator.storage.estimate` is
 * unavailable or throws, since we'd rather attempt the download than block it on a guess. */
async function ensureStorageBudget(neededBytes: number, largestFileBytes: number): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return;
  let estimate: StorageEstimate;
  try {
    estimate = await navigator.storage.estimate();
  } catch {
    return;
  }
  if (estimate.quota === undefined) return;
  const available = estimate.quota - (estimate.usage ?? 0);
  const required = neededBytes + largestFileBytes;
  if (available < required) {
    throw new InsufficientStorageError(
      `Not enough storage space for the speech model — needs about ${formatMB(required)} free.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Network: retrying range fetches, offline pause
// ---------------------------------------------------------------------------

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Resolves immediately if online (or if the environment doesn't expose navigator.onLine);
 * otherwise waits for the 'online' event so an interrupted download pauses instead of
 * burning through retries while offline. */
function waitForOnline(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return Promise.resolve();
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const cleanup = () => {
      window.removeEventListener("online", onOnline);
      signal?.removeEventListener("abort", onAbort);
    };
    const onOnline = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    window.addEventListener("online", onOnline, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

interface RangeFetchResult {
  bytes: ArrayBuffer;
  totalBytes: number;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
}

function parseTotalFromContentRange(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const match = /\/(\d+)\s*$/.exec(headerValue);
  return match ? Number(match[1]) : null;
}

async function fetchRange(url: string, start: number, end: number, signal?: AbortSignal): Promise<RangeFetchResult> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
  if (res.status === 200) {
    // The server ignored our Range header — the response is the *whole* file, not our slice.
    // Rare, but treat as a hard failure for this chunk rather than silently caching wrong
    // bytes under a chunk index.
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`Server did not honor the Range request for ${url} (got 200, expected 206).`);
  }
  if (res.status !== 206) {
    throw new Error(`Unexpected HTTP ${res.status} while downloading part of ${url}.`);
  }
  const totalBytes = parseTotalFromContentRange(res.headers.get("content-range"));
  if (totalBytes === null) {
    throw new Error(`Missing or unparseable Content-Range header for ${url}.`);
  }
  const bytes = await res.arrayBuffer();
  return {
    bytes,
    totalBytes,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    contentType: res.headers.get("content-type"),
  };
}

async function fetchRangeWithRetry(url: string, start: number, end: number, signal?: AbortSignal): Promise<RangeFetchResult> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_CHUNK_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await waitForOnline(signal);
    try {
      return await fetchRange(url, start, end, signal);
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastErr = err;
      if (attempt < MAX_CHUNK_RETRIES) {
        await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), signal);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface ModelDownloadProgress {
  label: string;
  /** 0..1 when known, null when indeterminate (e.g. before the first byte lands). */
  fraction: number | null;
}

export type OnModelDownloadProgress = (progress: ModelDownloadProgress) => void;

interface OverallProgressState {
  fileProgress: Map<string, FileBytesProgress>;
  rateSamples: RateSample[];
  lastEmit: number;
  resuming: boolean;
}

function emitProgress(state: OverallProgressState, onProgress: OnModelDownloadProgress | undefined, force: boolean): void {
  if (!onProgress) return;
  const now = Date.now();
  if (!shouldEmitProgressUpdate(state.lastEmit, now, PROGRESS_THROTTLE_MS, force)) return;
  state.lastEmit = now;

  const { loaded, total } = aggregateBytes(state.fileProgress);
  if (total === 0) {
    onProgress({ label: state.resuming ? "Resuming — preparing…" : "Downloading speech model (once)", fraction: null });
    return;
  }
  state.rateSamples = pushRateSample(state.rateSamples, { t: now, bytes: loaded });
  const bytesPerSecond = estimateRateBytesPerSec(state.rateSamples);
  const etaSeconds = estimateEtaSeconds(total - loaded, bytesPerSecond);
  onProgress({
    label: formatDownloadLabel({ loadedBytes: loaded, totalBytes: total, bytesPerSecond, etaSeconds, resuming: state.resuming }),
    fraction: loaded / total,
  });
}

// ---------------------------------------------------------------------------
// Per-file download
// ---------------------------------------------------------------------------

function chunkByteLength(chunkIndex: number, totalBytes: number): number {
  return Math.min(CHUNK_SIZE, totalBytes - chunkIndex * CHUNK_SIZE);
}

function fileMetaMatches(existing: FileMetaRecord | null, totalBytes: number, etag: string | null, lastModified: string | null): boolean {
  if (!existing) return false;
  if (existing.totalBytes !== totalBytes) return false;
  if (existing.etag !== null && etag !== null) return existing.etag === etag;
  if (existing.lastModified !== null && lastModified !== null) return existing.lastModified === lastModified;
  // Neither side has an ETag/Last-Modified to compare against (unlikely for Hugging Face,
  // but possible) — fall back to the totalBytes match above as a best-effort signal.
  return true;
}

/**
 * Streams a file's chunks back out of IndexedDB in order, deleting each one as soon as it's
 * actually pulled (not in a batch after cache.put() returns): the real Cache API consumes a
 * response body immediately when you call put() (per spec, it has to — it needs the bytes to
 * store), but nothing guarantees that timing to us, so deleting eagerly-but-only-once-read is
 * what keeps this correct regardless of when/how the body is drained.
 */
function buildChunkStream(url: string, chunkCount: number): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= chunkCount) {
        controller.close();
        await deleteFileMeta(url).catch(() => undefined);
        return;
      }
      const record = await getChunk(url, index);
      if (!record) {
        controller.error(new Error(`Missing chunk ${index}/${chunkCount} for ${url} while assembling the cached file.`));
        return;
      }
      controller.enqueue(new Uint8Array(record.bytes));
      await deleteChunk(url, index);
      index++;
    },
  });
}

interface FilePlan {
  url: string;
  expectedBytes: number;
}

async function downloadFile(
  file: FilePlan,
  cache: Cache,
  state: OverallProgressState,
  onProgress: OnModelDownloadProgress | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  // Probe file metadata (total size, ETag/Last-Modified) by ranging for what would be chunk
  // 0 anyway — no wasted request. A server that clamps an over-long range (standard HTTP
  // range-request behavior) will correctly return a shorter first "chunk" for small aux files.
  const probe = await fetchRangeWithRetry(file.url, 0, CHUNK_SIZE - 1, signal);
  const totalBytes = probe.totalBytes;
  const chunkCount = Math.max(1, Math.ceil(totalBytes / CHUNK_SIZE));

  const existingMeta = await getFileMeta(file.url);
  const sameFile = fileMetaMatches(existingMeta, totalBytes, probe.etag, probe.lastModified);
  if (existingMeta && !sameFile) {
    // The file changed on the server (or we can't be sure it didn't) since the last attempt —
    // discard whatever chunks we'd stored for it and restart from scratch.
    await deleteChunksForUrl(file.url);
  }

  const priorIndexes = sameFile ? await listChunkIndexes(file.url) : new Set<number>();
  if (priorIndexes.size > 0) state.resuming = true;

  await putFileMeta({
    url: file.url,
    totalBytes,
    etag: probe.etag,
    lastModified: probe.lastModified,
    contentType: probe.contentType,
    chunkSize: CHUNK_SIZE,
    chunkCount,
  });

  if (!priorIndexes.has(0)) {
    await putChunk(file.url, 0, probe.bytes);
    priorIndexes.add(0);
  }

  let loadedBytes = 0;
  for (const idx of priorIndexes) loadedBytes += chunkByteLength(idx, totalBytes);
  state.fileProgress.set(file.url, { loaded: loadedBytes, total: totalBytes });
  emitProgress(state, onProgress, true);

  const missingIndexes: number[] = [];
  for (let i = 0; i < chunkCount; i++) {
    if (!priorIndexes.has(i)) missingIndexes.push(i);
  }

  let cursor = 0;
  let firstError: unknown = null;

  async function worker(): Promise<void> {
    for (;;) {
      if (firstError || signal?.aborted) return;
      const myPos = cursor++;
      if (myPos >= missingIndexes.length) return;
      const chunkIndex = missingIndexes[myPos]!;
      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalBytes) - 1;
      try {
        const result = await fetchRangeWithRetry(file.url, start, end, signal);
        await putChunk(file.url, chunkIndex, result.bytes);
        loadedBytes += result.bytes.byteLength;
        state.fileProgress.set(file.url, { loaded: loadedBytes, total: totalBytes });
        emitProgress(state, onProgress, false);
      } catch (err) {
        firstError ??= err;
        return;
      }
    }
  }

  const concurrency = Math.min(MAX_PARALLEL_CHUNKS, Math.max(1, missingIndexes.length));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (firstError) throw firstError;
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  emitProgress(state, onProgress, true);

  // Every chunk is present — stream them back out in order and hand the assembled file to
  // transformers.js's own Cache Storage entry, under its exact cache-key URL. Chunks (and the
  // file's metadata record) are freed as the stream is actually drained (see buildChunkStream)
  // rather than in a batch right after this call — cache.put() only resolving once its
  // consumer is done reading isn't something we can safely assume.
  const stream = buildChunkStream(file.url, chunkCount);
  const headers = new Headers();
  if (probe.contentType) headers.set("content-type", probe.contentType);
  headers.set("content-length", String(totalBytes));
  await cache.put(file.url, new Response(stream, { headers }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EnsureModelDownloadedOptions {
  onProgress?: OnModelDownloadProgress;
  signal?: AbortSignal;
}

/**
 * Ensures every file transformers.js needs for `repoId`+`dtype` (see
 * modelCatalog.modelFilesWithUrls) is present in the "transformers-cache" Cache Storage
 * entry transformers.js reads from — downloading via resumable, chunked Range requests
 * first. Files already fully cached are skipped entirely (no network request). Safe to call
 * repeatedly (e.g. after an interruption): resumes from whatever chunks were already stored.
 *
 * Throws InsufficientStorageError if there isn't room, or the underlying fetch/DB error on
 * failure (after per-chunk retries) — callers should catch and surface a message; finished
 * chunks are always kept on failure so a retry doesn't restart from zero.
 */
export async function ensureModelDownloaded(repoId: string, dtype: string, options: EnsureModelDownloadedOptions = {}): Promise<void> {
  const { onProgress, signal } = options;
  const files = modelFilesWithUrls(repoId, dtype);
  if (files.length === 0) return;
  if (typeof caches === "undefined") {
    throw new Error("This browser doesn't support Cache Storage, which the speech model needs to be stored in.");
  }

  const cache = await caches.open(TRANSFORMERS_CACHE_NAME);

  const pending: FilePlan[] = [];
  for (const f of files) {
    const hit = await cache.match(f.url);
    if (!hit) pending.push({ url: f.url, expectedBytes: f.bytes });
  }
  if (pending.length === 0) return;

  await persistStorageBestEffort();

  const alreadyStoredBytes = (await Promise.all(pending.map((f) => sumStoredChunkBytes(f.url)))).reduce((a, b) => a + b, 0);
  const neededBytes = Math.max(0, pending.reduce((a, f) => a + f.expectedBytes, 0) - alreadyStoredBytes);
  const largestFileBytes = Math.max(...pending.map((f) => f.expectedBytes));
  await ensureStorageBudget(neededBytes, largestFileBytes);

  const state: OverallProgressState = {
    fileProgress: new Map(pending.map((f) => [f.url, { loaded: 0, total: f.expectedBytes }])),
    rateSamples: [],
    lastEmit: 0,
    resuming: false,
  };

  for (const file of pending) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await downloadFile(file, cache, state, onProgress, signal);
  }

  emitProgress(state, onProgress, true);
}

/**
 * Bytes still needed to finish downloading this model+dtype, accounting for both files
 * already fully cached (transformers.js's own Cache Storage) AND partial progress sitting in
 * the chunks DB from an interrupted attempt — unlike modelCatalog.remainingBytesToDownload,
 * which only knows about whole-file cache hits. Used by the consent dialog so a resumed
 * download shows the true remaining size, not the full size again.
 */
export async function remainingBytesToDownload(repoId: string, dtype: string): Promise<number> {
  const files = modelFilesWithUrls(repoId, dtype);
  if (files.length === 0) return 0;
  const total = files.reduce((a, f) => a + f.bytes, 0);
  if (typeof caches === "undefined") return total;
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    let remaining = 0;
    for (const f of files) {
      const hit = await cache.match(f.url);
      if (hit) continue;
      const storedBytes = await sumStoredChunkBytes(f.url);
      remaining += Math.max(0, f.bytes - storedBytes);
    }
    return remaining;
  } catch {
    return total;
  }
}
