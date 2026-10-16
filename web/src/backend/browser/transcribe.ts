// Orchestrates decode -> Whisper worker -> Transcript for the browser backend.
// Mirrors server/src/pipeline/transcribe.ts's role (audio -> Transcript) but
// runs entirely client-side: transformers.js in a Web Worker instead of
// whisper-cli, and Web Audio API instead of ffmpeg.
//
// The whole clip goes to the worker in one call (transformers.js chunks it with overlap). If a
// phone suspends the tab and the worker dies or stalls, runner.ts restarts the transcription
// when the visitor is back.

import type { Transcript } from "@recipe/shared";
import { decodeTo16kMono } from "./audio";
import { cleanTranscriptSegments } from "./transcriptCleanup";
import { describeTranscriptionError } from "./downloadErrors";
import { SAMPLE_RATE, windowChunksToSegments, type WindowChunk } from "./windows";
import type { RunRequest, WorkerMessage, WorkerProgress } from "./whisper.worker";

export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionError";
  }
}

/** The worker stopped answering while the page was visible (e.g. the OS froze it while the
 * tab was in the background and it never woke up). The runner treats it as an interruption. */
export class TranscriptionStalledError extends TranscriptionError {
  constructor() {
    super("Transcription stopped responding.");
    this.name = "TranscriptionStalledError";
  }
}

export type TranscribeProgressListener = (progress: WorkerProgress) => void;

export interface WindowProgress {
  totalSeconds: number;
  doneSeconds: number;
  /** Seconds that were already done from a checkpoint when this run started. */
  resumedFromSeconds: number;
  /** Seconds transcribed in this run, and the wall time they took (for the speed estimate). */
  measuredSeconds: number;
  measuredMs: number;
  device: "webgpu" | "wasm";
}

export interface TranscribeOptions {
  /** Start/finish of the whole-clip run, for the time-left estimate (lib/transcriptionEta.ts). */
  onWindowProgress?: (progress: WindowProgress) => void;
}

export function preferredDevice(): "webgpu" | "wasm" {
  return typeof navigator !== "undefined" && (navigator as Navigator & { gpu?: unknown }).gpu ? "webgpu" : "wasm";
}

// A single Worker is reused across windows and jobs (not one per call) so the pipeline it
// loads (see whisper.worker.ts's cachedPipeline) survives — only the first window of a session
// pays for loading the model. The runner (runner.ts) processes one job at a time, so there's
// never more than one window in flight against this worker.
let sharedWorker: Worker | null = null;

function getWorker(): Worker {
  sharedWorker ??= new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  return sharedWorker;
}

/** Discards the shared worker (e.g. after it crashed) so the next call gets a
 * fresh one instead of reusing one in an unknown state. */
function discardWorker(worker: Worker): void {
  if (sharedWorker === worker) sharedWorker = null;
  worker.terminate();
}

/** Base allowance with no message from the worker while the page is visible (model load +
 * WebGPU compile); transcribeAudio adds time proportional to the clip, since one call over the
 * whole clip reports nothing until it finishes. */
const STALL_BASE_MS = 5 * 60_000;
/** Visible ms allowed per second of audio: 3× real time covers the small model on WASM. */
const STALL_MS_PER_AUDIO_SECOND = 3_000;
const STALL_TICK_MS = 5_000;

function runWindow(
  worker: Worker,
  req: RunRequest,
  onProgress: TranscribeProgressListener | undefined,
  onModelReady: () => void,
  stallMs: number,
): Promise<{ text: string; chunks: WindowChunk[] }> {
  return new Promise((resolve, reject) => {
    let idleVisibleMs = 0;
    const tick = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      idleVisibleMs += STALL_TICK_MS;
      if (idleVisibleMs >= stallMs) {
        clearInterval(tick);
        discardWorker(worker);
        reject(new TranscriptionStalledError());
      }
    }, STALL_TICK_MS);

    worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      idleVisibleMs = 0;
      const msg = ev.data;
      if (msg.type === "progress") {
        // Model loading is reported as-is until it's ready; per-window "Transcribing" ticks are
        // replaced by window-level progress from transcribeAudio.
        if (msg.stage === "download") {
          if (msg.fraction === 1) onModelReady();
          else onProgress?.(msg);
        }
      } else if (msg.type === "result") {
        clearInterval(tick);
        resolve({ text: msg.text, chunks: msg.chunks });
      } else if (msg.type === "error") {
        clearInterval(tick);
        // Discard the shared worker on any failure (not just a hard crash — a dropped
        // connection mid-download can leave the worker's onnxruntime/transformers.js state
        // inconsistent) so the next attempt (Retry) always starts from a fresh Worker.
        discardWorker(worker);
        reject(new TranscriptionError(describeTranscriptionError(msg.message)));
      }
    };
    worker.onerror = (e) => {
      clearInterval(tick);
      discardWorker(worker);
      reject(new TranscriptionError(describeTranscriptionError(e.message || "The transcription worker crashed.")));
    };
    // Transfer the window's buffer to avoid copying (the worker owns it after this).
    worker.postMessage(req, [req.audio.buffer]);
  });
}

/**
 * Decodes the given audio blob and runs it through the in-browser Whisper
 * pipeline in the shared Worker, window by window. Resolves with a cleaned Transcript.
 */
export async function transcribeAudio(
  blob: Blob,
  modelId: string,
  dtype: string,
  onProgress?: TranscribeProgressListener,
  options: TranscribeOptions = {},
): Promise<Transcript> {
  onProgress?.({ type: "progress", stage: "download", label: "Decoding audio", fraction: null });
  const arrayBuffer = await blob.arrayBuffer();

  let audio: Float32Array;
  try {
    ({ audio } = await decodeTo16kMono(arrayBuffer));
  } catch (err) {
    throw new TranscriptionError(err instanceof Error ? err.message : String(err));
  }

  const device = preferredDevice();
  const totalSeconds = audio.length / SAMPLE_RATE;
  const report = (doneSeconds: number, measuredSeconds = 0, measuredMs = 0) =>
    options.onWindowProgress?.({ totalSeconds, doneSeconds, resumedFromSeconds: 0, measuredSeconds, measuredMs, device });

  // One call over the whole clip: transformers.js chunks it into 30 s windows with 5 s of
  // overlap and stitches them. We tried transcribing separate ≤30 s windows (to checkpoint and
  // resume mid-clip), but on the egg-fried-rice eval clip Whisper then skipped whole spoken
  // stretches ("season the egg… whisk with chopsticks") that the overlapping run keeps — so a
  // suspended job restarts the transcription instead (runner.ts), which is slower but complete.
  report(0);
  const started = Date.now();
  let modelReadyAt = started;
  const stallMs = STALL_BASE_MS + Math.round(totalSeconds * STALL_MS_PER_AUDIO_SECOND);
  const result = await runWindow(getWorker(), { type: "run", modelId, dtype, device, audio }, onProgress, () => {
    modelReadyAt = Date.now();
    report(0);
  }, stallMs);
  report(totalSeconds, totalSeconds, Date.now() - modelReadyAt);
  const segments = windowChunksToSegments(result.chunks, result.text, 0, totalSeconds);

  return { language: null, segments: cleanTranscriptSegments(segments) };
}
