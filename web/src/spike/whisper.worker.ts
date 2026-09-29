/// <reference lib="webworker" />
// Web Worker that loads a transformers.js Whisper pipeline and runs ASR on a
// Float32Array of 16kHz mono PCM handed to it from the main thread. Runs off
// the main thread so the UI stays responsive during model download + inference.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export interface RunRequest {
  type: "run";
  modelId: string;
  dtype: string;
  device: "webgpu" | "wasm";
  audio: Float32Array;
}

export type WorkerMessage =
  | { type: "progress"; phase: "model-download"; file?: string; progress?: number; status: string }
  | { type: "load-done"; loadMs: number }
  | { type: "transcribe-progress"; note: string }
  | {
      type: "result";
      text: string;
      chunks: { text: string; timestamp: [number, number | null] }[];
      transcribeMs: number;
    }
  | { type: "error"; message: string };

let cachedKey: string | null = null;
let cachedPipeline: AutomaticSpeechRecognitionPipeline | null = null;

self.onmessage = async (ev: MessageEvent<RunRequest>) => {
  const { modelId, dtype, device, audio } = ev.data;
  const key = `${modelId}::${dtype}::${device}`;

  try {
    let loadMs = 0;
    if (cachedKey !== key || !cachedPipeline) {
      const t0 = performance.now();
      cachedPipeline = (await pipeline("automatic-speech-recognition", modelId, {
        dtype: dtype as never,
        device,
        progress_callback: (info: Record<string, unknown>) => {
          const status = String(info.status ?? "");
          post({
            type: "progress",
            phase: "model-download",
            file: typeof info.file === "string" ? info.file : undefined,
            progress: typeof info.progress === "number" ? info.progress : undefined,
            status,
          });
        },
      })) as AutomaticSpeechRecognitionPipeline;
      cachedKey = key;
      loadMs = performance.now() - t0;
      post({ type: "load-done", loadMs });
    } else {
      post({ type: "load-done", loadMs: 0 });
    }

    post({ type: "transcribe-progress", note: "running inference…" });
    const t1 = performance.now();
    const output = await cachedPipeline(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });
    const transcribeMs = performance.now() - t1;

    const single = Array.isArray(output) ? output[0] : output;
    const chunks = (single.chunks ?? []).map((c: { text: string; timestamp: [number, number] }) => ({
      text: c.text,
      timestamp: c.timestamp as [number, number | null],
    }));

    post({
      type: "result",
      text: single.text,
      chunks,
      transcribeMs,
    });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err) });
  }
};

function post(msg: WorkerMessage) {
  (self as unknown as Worker).postMessage(msg);
}
