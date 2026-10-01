// Orchestrates decode -> Whisper worker -> Transcript for the browser backend.
// Mirrors server/src/pipeline/transcribe.ts's role (audio -> Transcript) but
// runs entirely client-side: transformers.js in a Web Worker instead of
// whisper-cli, and Web Audio API instead of ffmpeg.

import type { Transcript, TranscriptSegment } from "@recipe/shared";
import { decodeTo16kMono } from "./audio";
import { cleanTranscriptSegments } from "./transcriptCleanup";
import { describeTranscriptionError } from "./downloadErrors";
import type { RunRequest, WorkerMessage, WorkerProgress } from "./whisper.worker";

export class TranscriptionError extends Error {}

export type TranscribeProgressListener = (progress: WorkerProgress) => void;

function preferredDevice(): "webgpu" | "wasm" {
  return (navigator as Navigator & { gpu?: unknown }).gpu ? "webgpu" : "wasm";
}

// A single Worker is reused across transcribeAudio() calls (not one per call)
// so the pipeline it loads (see whisper.worker.ts's cachedPipeline) survives
// between jobs — re-transcribing, or transcribing a second job with the same
// model/dtype/device, doesn't re-download or re-initialize the model. The
// runner (runner.ts) processes one job at a time, so there's never more than
// one transcribeAudio() call in flight against this worker.
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

function chunksToSegments(chunks: { text: string; timestamp: [number, number | null] }[], fallbackText: string): TranscriptSegment[] {
  if (chunks.length === 0) {
    const trimmed = fallbackText.trim();
    return trimmed ? [{ start: 0, end: 0, text: trimmed }] : [];
  }
  const segments: TranscriptSegment[] = [];
  for (const c of chunks) {
    const trimmed = c.text.trim();
    if (!trimmed) continue;
    const start = c.timestamp[0] ?? 0;
    const end = c.timestamp[1] ?? start;
    segments.push({ start, end, text: trimmed });
  }
  return segments;
}

/**
 * Decodes the given audio blob and runs it through the in-browser Whisper
 * pipeline in the shared Worker. Resolves with a cleaned Transcript.
 */
export async function transcribeAudio(
  blob: Blob,
  modelId: string,
  dtype: string,
  onProgress?: TranscribeProgressListener,
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
  const worker = getWorker();

  const result = await new Promise<{ text: string; chunks: { text: string; timestamp: [number, number | null] }[] }>(
    (resolve, reject) => {
      worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
        const msg = ev.data;
        if (msg.type === "progress") {
          onProgress?.(msg);
        } else if (msg.type === "result") {
          resolve({ text: msg.text, chunks: msg.chunks });
        } else if (msg.type === "error") {
          // Discard the shared worker on any failure (not just a hard crash — a dropped
          // connection mid-download can leave the worker's onnxruntime/transformers.js state
          // inconsistent) so the next attempt (Retry) always starts from a fresh Worker.
          discardWorker(worker);
          reject(new TranscriptionError(describeTranscriptionError(msg.message)));
        }
      };
      worker.onerror = (e) => {
        discardWorker(worker);
        reject(new TranscriptionError(describeTranscriptionError(e.message || "The transcription worker crashed.")));
      };

      const req: RunRequest = { type: "run", modelId, dtype, device, audio };
      // Transfer the audio buffer to avoid copying (the worker owns it after this).
      worker.postMessage(req, [audio.buffer]);
    },
  );

  const rawSegments = chunksToSegments(result.chunks, result.text);
  const segments = cleanTranscriptSegments(rawSegments);
  return { language: null, segments };
}
