// Source of truth for the in-browser Whisper speech models this app offers, and for
// checking whether a given model+dtype is already downloaded in this browser's Cache
// Storage. Consumed by the Settings page and by the model-download consent dialog.
//
// Byte sizes below are the *actual* sizes of the files transformers.js fetches for each
// (repo, dtype) pair — verified against the Hugging Face API, not estimated. transformers.js
// resolves a whisper pipeline (a Seq2Seq model, see node_modules/@huggingface/transformers/
// src/models/session_config.js MODEL_SESSION_CONFIG[MODEL_TYPES.Seq2Seq]) to exactly two onnx
// sessions — "encoder_model" and "decoder_model_merged" — plus a handful of small JSON/tokenizer
// files. A string dtype (e.g. "q4") is applied to both onnx files via the same filename suffix
// (see src/models/session_config.js DEFAULT_DTYPE_SUFFIX_MAPPING: q4 -> "_q4").
//
// Verified via, on 2026-09-29 (re-run if a repo's files change):
//   curl -s "https://huggingface.co/api/models/<repo>/tree/main/onnx?expand=true"
//   curl -s "https://huggingface.co/api/models/<repo>/tree/main?expand=true"

export interface CatalogFile {
  /** Path relative to the repo root, as used in the resolve/main/ URL. */
  file: string;
  bytes: number;
}

function sumBytes(files: CatalogFile[]): number {
  return files.reduce((total, f) => total + f.bytes, 0);
}

// onnx/encoder_model_q4.onnx + onnx/decoder_model_merged_q4.onnx + the small config/tokenizer
// files a whisper pipeline load fetches, from the HF tree API listing for each repo.
const LARGE_V3_TURBO_FILES: CatalogFile[] = [
  { file: "onnx/encoder_model_q4.onnx", bytes: 424_942_775 },
  { file: "onnx/decoder_model_merged_q4.onnx", bytes: 334_147_222 },
  { file: "config.json", bytes: 1_332 },
  { file: "generation_config.json", bytes: 3_897 },
  { file: "preprocessor_config.json", bytes: 340 },
  { file: "tokenizer.json", bytes: 2_480_617 },
  { file: "tokenizer_config.json", bytes: 282_843 },
];

const WHISPER_SMALL_FILES: CatalogFile[] = [
  { file: "onnx/encoder_model_q4.onnx", bytes: 66_182_104 },
  { file: "onnx/decoder_model_merged_q4.onnx", bytes: 233_149_327 },
  { file: "config.json", bytes: 2_227 },
  { file: "generation_config.json", bytes: 3_893 },
  { file: "preprocessor_config.json", bytes: 339 },
  { file: "tokenizer.json", bytes: 2_480_466 },
  { file: "tokenizer_config.json", bytes: 282_683 },
];

export interface SpeechModelOption {
  /** Hugging Face repo id, e.g. "onnx-community/whisper-large-v3-turbo". */
  repoId: string;
  dtype: string;
  /** Short label for pickers, e.g. "Large v3 turbo (q4)". */
  label: string;
  /** Total bytes fetched on first use: encoder + decoder-merged onnx + aux config/tokenizer files. */
  downloadBytes: number;
  /** One-line, honest trade-off shown next to the size (per web/src/spike/RESULTS.md). */
  tradeoff: string;
}

export function speechModelKey(repoId: string, dtype: string): string {
  return `${repoId}::${dtype}`;
}

const CATALOG_FILES: Record<string, CatalogFile[]> = {
  [speechModelKey("onnx-community/whisper-large-v3-turbo", "q4")]: LARGE_V3_TURBO_FILES,
  [speechModelKey("onnx-community/whisper-small", "q4")]: WHISPER_SMALL_FILES,
};

export const SPEECH_MODEL_CATALOG: SpeechModelOption[] = [
  {
    repoId: "onnx-community/whisper-large-v3-turbo",
    dtype: "q4",
    label: "Large v3 turbo (q4)",
    downloadBytes: sumBytes(LARGE_V3_TURBO_FILES), // ~762 MB
    tradeoff: "Bigger download, but ~6x faster than real time and the most accurate (default).",
  },
  {
    repoId: "onnx-community/whisper-small",
    dtype: "q4",
    label: "Whisper small (q4)",
    downloadBytes: sumBytes(WHISPER_SMALL_FILES), // ~302 MB
    tradeoff: "Smaller download, but only about real-time speed (a 7-min clip takes ~7 min) and less accurate.",
  },
];

export function findSpeechModelOption(repoId: string, dtype: string): SpeechModelOption | undefined {
  return SPEECH_MODEL_CATALOG.find((o) => o.repoId === repoId && o.dtype === dtype);
}

export const DEFAULT_SPEECH_MODEL = SPEECH_MODEL_CATALOG[0]!;

/** The Cache Storage name transformers.js uses in the browser (env.cacheKey's default,
 * see node_modules/@huggingface/transformers/src/env.js: `cacheKey: 'transformers-cache'`). */
export const TRANSFORMERS_CACHE_NAME = "transformers-cache";

/** The catalog file list for a model+dtype, or `[]` if it isn't in the catalog (e.g. a
 * value left over in localStorage from a since-removed option). */
export function modelFiles(repoId: string, dtype: string): CatalogFile[] {
  return CATALOG_FILES[speechModelKey(repoId, dtype)] ?? [];
}

function fileUrl(repoId: string, file: string): string {
  // Mirrors buildResourcePaths' `remoteURL` in @huggingface/transformers/src/utils/hub.js:
  // `{remoteHost}{model}/resolve/{revision}/{filename}` with the default remoteHost and the
  // "main" revision — this app never passes a custom revision.
  return `https://huggingface.co/${repoId}/resolve/main/${file}`;
}

export interface CatalogFileWithUrl extends CatalogFile {
  /** The exact URL transformers.js will fetch/cache this file at — see fileUrl above. */
  url: string;
}

/** Like modelFiles(), but with each file's cache-key URL attached — used by
 * modelDownloader.ts, which needs both the expected byte count and the URL to range
 * against/store under. */
export function modelFilesWithUrls(repoId: string, dtype: string): CatalogFileWithUrl[] {
  return modelFiles(repoId, dtype).map((f) => ({ ...f, url: fileUrl(repoId, f.file) }));
}

/**
 * The exact request URLs transformers.js uses as Cache Storage keys for a given model+dtype.
 */
export function requiredModelFileUrls(repoId: string, dtype: string): string[] {
  return modelFiles(repoId, dtype).map((f) => fileUrl(repoId, f.file));
}

/**
 * Whether every file transformers.js needs for this model+dtype is already present in the
 * browser's Cache Storage (i.e. the model is fully downloaded and won't be re-fetched).
 * Fails safe: if Cache Storage is unavailable or throws, resolves to `false` (so callers
 * that gate a download prompt on this will still show the prompt rather than silently
 * assuming the model is ready).
 */
export async function isModelCached(repoId: string, dtype: string): Promise<boolean> {
  const files = modelFiles(repoId, dtype);
  if (files.length === 0) return false;
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    const results = await Promise.all(files.map((f) => cache.match(fileUrl(repoId, f.file))));
    return results.every((r) => r !== undefined);
  } catch {
    return false;
  }
}

/**
 * Bytes still needed to finish downloading this model+dtype: the catalog's full size minus
 * whichever files are already present in Cache Storage (transformers.js only caches a file
 * once it has downloaded completely — see node_modules/@huggingface/transformers/src/utils/
 * hub.js's loadResourceFile, which reads the full response into a buffer via readResponse()
 * before calling storeCachedResource() — so a file interrupted mid-download is never
 * partially cached; this is whole-file granularity, not byte-level).
 *
 * Falls back to the full catalog size if Cache Storage is unavailable or throws, or if the
 * model isn't in the catalog.
 */
export async function remainingBytesToDownload(repoId: string, dtype: string): Promise<number> {
  const files = modelFiles(repoId, dtype);
  if (files.length === 0) return 0;
  const total = sumBytes(files);
  if (typeof caches === "undefined") return total;
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    let remaining = 0;
    for (const f of files) {
      const hit = await cache.match(fileUrl(repoId, f.file));
      if (!hit) remaining += f.bytes;
    }
    return remaining;
  } catch {
    return total;
  }
}
