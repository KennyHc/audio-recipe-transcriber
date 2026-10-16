/// <reference lib="webworker" />
// Web Worker that loads a transformers.js Whisper pipeline and runs ASR on a
// Float32Array of 16kHz mono PCM handed to it from the main thread. Runs off
// the main thread so the UI stays responsive during model download + inference.
//
// Productionises web/src/spike/whisper.worker.ts. Two changes from the spike:
//  1. Progress is aggregated across the model's (possibly many) onnx shard
//     downloads into a single 0..1 fraction, and THROTTLED to at most ~5
//     updates/sec — see web/src/spike/RESULTS.md's "Anomaly worth flagging":
//     unbounded progress-tick volume (one postMessage per network chunk, times
//     several shard files) was enough to hang the main thread with naive
//     per-tick DOM updates. Throttling at the source (here, before
//     postMessage) means the main thread never has to deal with the flood.
//  2. The loaded pipeline is kept between run requests (same behavior as the
//     spike) so re-transcribing or transcribing a second job doesn't re-download.

import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import {
  aggregateBytes,
  estimateEtaSeconds,
  estimateRateBytesPerSec,
  formatDownloadLabel,
  pushRateSample,
  shouldEmitProgressUpdate,
  type FileBytesProgress,
  type RateSample,
} from "@/lib/downloadProgress";

export interface RunRequest {
  type: "run";
  modelId: string;
  dtype: string;
  device: "webgpu" | "wasm";
  audio: Float32Array;
}

export interface WorkerProgress {
  type: "progress";
  stage: "download" | "transcribe";
  label: string;
  /** 0..1 when known, null when indeterminate. */
  fraction: number | null;
}

export type WorkerMessage =
  | WorkerProgress
  | {
      type: "result";
      text: string;
      chunks: { text: string; timestamp: [number, number | null] }[];
    }
  | { type: "error"; message: string };

const THROTTLE_MS = 200; // ~5 updates/sec

let cachedKey: string | null = null;
let cachedPipeline: AutomaticSpeechRecognitionPipeline | null = null;

self.onmessage = async (ev: MessageEvent<RunRequest>) => {
  const { modelId, dtype, device, audio } = ev.data;
  const key = `${modelId}::${dtype}::${device}`;

  try {
    if (cachedKey !== key || !cachedPipeline) {
      cachedPipeline = await loadPipeline(modelId, dtype, device);
      cachedKey = key;
    } else {
      post({ type: "progress", stage: "download", label: "Speech model ready (cached)", fraction: 1 });
    }

    post({ type: "progress", stage: "transcribe", label: "Transcribing", fraction: null });
    const output = await cachedPipeline(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      // Without a cap, timestamped generation can run forever on some audio (reproduced:
      // the outro of the egg-fried-rice eval clip hung indefinitely on both WebGPU and WASM;
      // capped, it finishes in ~1 s). Whisper's hard limit is 448 tokens per 30 s window,
      // and even very fast speech with timestamps stays well under 400.
      max_new_tokens: 400,
    });

    const single = Array.isArray(output) ? output[0] : output;
    const chunks = (single?.chunks ?? []).map((c: { text: string; timestamp: [number, number] }) => ({
      text: c.text,
      timestamp: c.timestamp as [number, number | null],
    }));

    post({ type: "result", text: single?.text ?? "", chunks });
  } catch (err) {
    // A failed run must not poison the cache for the next attempt (e.g. retry).
    cachedKey = null;
    cachedPipeline = null;
    post({ type: "error", message: err instanceof Error ? `${err.message}` : String(err) });
  }
};

async function loadPipeline(
  modelId: string,
  dtype: string,
  device: "webgpu" | "wasm",
): Promise<AutomaticSpeechRecognitionPipeline> {
  // Aggregate per-file download progress into total bytes loaded/total (transformers.js's
  // progress_callback gives real byte counts — loaded/total — per readResponse() in
  // node_modules/@huggingface/transformers/src/utils/hub/utils.js, not just a percentage),
  // then derive a smoothed rate/ETA for a label like:
  // "Downloading speech model (once) — 312 of 640 MB · 2.1 MB/s · ~2 min left"
  const fileProgress = new Map<string, FileBytesProgress>();
  let rateSamples: RateSample[] = [];
  let lastEmit = 0;

  const emitDownloadProgress = (force: boolean) => {
    const now = Date.now();
    if (!shouldEmitProgressUpdate(lastEmit, now, THROTTLE_MS, force)) return;
    lastEmit = now;

    const { loaded, total } = aggregateBytes(fileProgress);
    if (total === 0) {
      post({ type: "progress", stage: "download", label: "Downloading speech model (once)", fraction: null });
      return;
    }
    rateSamples = pushRateSample(rateSamples, { t: now, bytes: loaded });
    const bytesPerSecond = estimateRateBytesPerSec(rateSamples);
    const etaSeconds = estimateEtaSeconds(total - loaded, bytesPerSecond);
    post({
      type: "progress",
      stage: "download",
      label: formatDownloadLabel({ loadedBytes: loaded, totalBytes: total, bytesPerSecond, etaSeconds }),
      fraction: loaded / total,
    });
  };

  const result = (await pipeline("automatic-speech-recognition", modelId, {
    dtype: dtype as never,
    device,
    progress_callback: (info: Record<string, unknown>) => {
      const status = String(info.status ?? "");
      const file = typeof info.file === "string" ? info.file : "model";
      const loaded = typeof info.loaded === "number" ? info.loaded : null;
      const total = typeof info.total === "number" ? info.total : null;

      if (status === "progress" && loaded !== null && total !== null && total > 0) {
        fileProgress.set(file, { loaded, total });
        emitDownloadProgress(false);
      } else if (status === "done") {
        const known = fileProgress.get(file);
        fileProgress.set(file, known ? { loaded: known.total, total: known.total } : { loaded: 1, total: 1 });
        emitDownloadProgress(true);
      } else if (status === "initiate") {
        if (!fileProgress.has(file)) fileProgress.set(file, { loaded: 0, total: 0 });
        emitDownloadProgress(false);
      }
    },
  })) as AutomaticSpeechRecognitionPipeline;

  post({ type: "progress", stage: "download", label: "Speech model ready", fraction: 1 });
  return result;
}

function post(msg: WorkerMessage) {
  (self as unknown as Worker).postMessage(msg);
}
