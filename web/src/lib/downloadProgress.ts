// Pure helpers for aggregating and formatting in-browser model-download progress. Kept
// side-effect-free (no timers, no DOM) so they're easy to unit test; the caller (the whisper
// worker / job page) owns the actual clock and throttling loop.

/** Per-file download progress, bytes-based (transformers.js's progress_callback gives us
 * `progress` as a 0..100 percentage per file, not bytes — callers convert using the file's
 * known total from the model catalog before calling these). */
export interface FileBytesProgress {
  loaded: number;
  total: number;
}

/** Sums loaded/total bytes across every file in flight. A file that hasn't reported yet
 * (not present in `files`) is assumed to contribute 0 loaded of its catalog-known total,
 * so callers should seed `files` with every expected file at {loaded: 0, total} up front. */
export function aggregateBytes(files: Map<string, FileBytesProgress> | FileBytesProgress[]): FileBytesProgress {
  const values = files instanceof Map ? [...files.values()] : files;
  let loaded = 0;
  let total = 0;
  for (const f of values) {
    loaded += f.loaded;
    total += f.total;
  }
  return { loaded, total };
}

export interface RateSample {
  t: number; // ms, e.g. Date.now()
  bytes: number; // cumulative bytes loaded at time t
}

/** Minimum time span (ms) of samples required before a rate is considered "stable" enough
 * to display — avoids a jumpy, meaningless MB/s on the very first tick. */
export const RATE_STABLE_WINDOW_MS = 3_000;

/** Appends a sample and drops samples older than `windowMs` before the newest one, so the
 * rate estimate reflects recent throughput rather than the average since the start. */
export function pushRateSample(samples: RateSample[], sample: RateSample, windowMs = RATE_STABLE_WINDOW_MS * 2): RateSample[] {
  const next = [...samples, sample];
  const cutoff = sample.t - windowMs;
  return next.filter((s) => s.t >= cutoff);
}

/**
 * Estimates bytes/sec from the oldest-to-newest sample in the window, or `null` if there
 * isn't yet enough of a time span to call it stable (per RATE_STABLE_WINDOW_MS) — callers
 * use `null` to hide the rate/ETA rather than show a misleading instantaneous number.
 */
export function estimateRateBytesPerSec(samples: RateSample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const dtMs = last.t - first.t;
  if (dtMs < RATE_STABLE_WINDOW_MS) return null;
  const dBytes = last.bytes - first.bytes;
  if (dBytes <= 0) return 0;
  return dBytes / (dtMs / 1000);
}

/** Seconds remaining at the given rate, or `null` if the rate is unknown/zero/non-finite. */
export function estimateEtaSeconds(remainingBytes: number, bytesPerSecond: number | null): number | null {
  if (bytesPerSecond === null || bytesPerSecond <= 0 || !Number.isFinite(bytesPerSecond)) return null;
  if (remainingBytes <= 0) return 0;
  return remainingBytes / bytesPerSecond;
}

// Decimal megabytes (1 MB = 1,000,000 bytes), matching macOS/browsers and the sizes in
// modelCatalog.ts, so the dialog, Settings, and the progress label all agree.
const BYTES_PER_MB = 1_000_000;

/** e.g. 312_000_000 -> "312 MB" */
export function formatMB(bytes: number): string {
  const mb = bytes / BYTES_PER_MB;
  return `${Math.max(0, Math.round(mb))} MB`;
}

/** e.g. 2_150_000 -> "2.1 MB/s" */
export function formatRate(bytesPerSecond: number): string {
  const mbps = bytesPerSecond / BYTES_PER_MB;
  if (mbps < 0.1) return "<0.1 MB/s";
  return `${mbps.toFixed(1)} MB/s`;
}

/** e.g. 125 -> "~2 min left", 40 -> "~40 sec left" */
export function formatEta(seconds: number): string {
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))} sec left`;
  const minutes = Math.round(seconds / 60);
  return `~${minutes} min left`;
}

export interface DownloadLabelInput {
  loadedBytes: number;
  totalBytes: number;
  bytesPerSecond: number | null;
  etaSeconds: number | null;
  /** True when this download picked up existing chunks from a previous, interrupted
   * attempt (see backend/browser/modelDownloader.ts) — changes the label's prefix from
   * "Downloading" to "Resuming" so it's clear progress wasn't lost. */
  resuming?: boolean;
}

/**
 * Builds the full progress label, e.g.
 * "Downloading speech model (once) — 312 of 640 MB · 2.1 MB/s · ~2 min left"
 * or, when resuming a previously-interrupted download:
 * "Resuming — 312 of 640 MB · 2.1 MB/s · ~2 min left"
 * Degrades gracefully: omits the rate/ETA segment(s) until they're known (see
 * estimateRateBytesPerSec / estimateEtaSeconds — both return null until stable).
 */
export function formatDownloadLabel({ loadedBytes, totalBytes, bytesPerSecond, etaSeconds, resuming = false }: DownloadLabelInput): string {
  const loadedMB = Math.max(0, Math.round(loadedBytes / BYTES_PER_MB));
  const parts = [`${loadedMB} of ${formatMB(totalBytes)}`];
  if (bytesPerSecond !== null && bytesPerSecond > 0) {
    parts.push(formatRate(bytesPerSecond));
    if (etaSeconds !== null) parts.push(formatEta(etaSeconds));
  }
  const prefix = resuming ? "Resuming" : "Downloading speech model (once)";
  return `${prefix} — ${parts.join(" · ")}`;
}

/** ~4 updates/sec max: true if at least `minIntervalMs` has passed since the last emitted
 * update (or `force` is set, e.g. for a final 100% update that must not be dropped). */
export function shouldEmitProgressUpdate(lastEmitMs: number, nowMs: number, minIntervalMs = 250, force = false): boolean {
  return force || nowMs - lastEmitMs >= minIntervalMs;
}
