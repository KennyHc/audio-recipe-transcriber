import { decodeTo16kMono } from "./audio";
import { MODEL_OPTIONS } from "./models";
import type { Transcript, TranscriptSegment } from "./transcript";
import type { RunRequest, WorkerMessage } from "./whisper.worker";

const DEFAULT_AUDIO_URL = "/api/jobs/oGJ7cuzG07uDn4uMNn-mM/audio";

interface Metrics {
  modelId: string;
  dtype: string;
  device: string;
  loadMs: number;
  transcribeMs: number;
  audioDurationS: number;
  realTimeFactor: number;
}

declare global {
  interface Window {
    __spikeResult?: { transcript: Transcript; metrics: Metrics };
  }
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const urlInput = $<HTMLInputElement>("#audio-url");
const fileInput = $<HTMLInputElement>("#audio-file");
const modelSelect = $<HTMLSelectElement>("#model-select");
const dtypeSelect = $<HTMLSelectElement>("#dtype-select");
const deviceLabel = $<HTMLSpanElement>("#device-label");
const runBtn = $<HTMLButtonElement>("#run-btn");
const statusEl = $<HTMLPreElement>("#status");
const metricsEl = $<HTMLPreElement>("#metrics");
const outputEl = $<HTMLPreElement>("#output");
const downloadBtn = $<HTMLButtonElement>("#download-btn");

urlInput.value = DEFAULT_AUDIO_URL;

const preferredDevice: "webgpu" | "wasm" = (navigator as Navigator & { gpu?: unknown }).gpu ? "webgpu" : "wasm";
deviceLabel.textContent = preferredDevice;

for (const m of MODEL_OPTIONS) {
  const opt = document.createElement("option");
  opt.value = m.id;
  opt.textContent = m.label;
  modelSelect.appendChild(opt);
}

function populateDtypes() {
  const model = MODEL_OPTIONS.find((m) => m.id === modelSelect.value)!;
  dtypeSelect.innerHTML = "";
  for (const dt of model.dtypes) {
    const opt = document.createElement("option");
    opt.value = dt;
    opt.textContent = dt;
    if (dt === model.defaultDtype) opt.selected = true;
    dtypeSelect.appendChild(opt);
  }
}
modelSelect.addEventListener("change", populateDtypes);
populateDtypes();

let worker: Worker | null = null;
let currentTranscript: Transcript | null = null;

// Cap growth: this page has seen thousands of progress ticks for a single
// large model download, and repeated `textContent +=` on an ever-growing
// string plus a scrollTop reflow on every append is O(n^2) and hangs the
// main thread. Keep a bounded ring buffer and re-render occasionally instead.
const MAX_LOG_LINES = 300;
const logLines: string[] = [];
let pendingLogFlush = false;

function log(line: string) {
  logLines.push(line);
  if (logLines.length > MAX_LOG_LINES) logLines.splice(0, logLines.length - MAX_LOG_LINES);
  if (!pendingLogFlush) {
    pendingLogFlush = true;
    requestAnimationFrame(() => {
      statusEl.textContent = logLines.join("\n");
      statusEl.scrollTop = statusEl.scrollHeight;
      pendingLogFlush = false;
    });
  }
}

async function loadAudio(): Promise<ArrayBuffer> {
  const file = fileInput.files?.[0];
  if (file) {
    log(`Reading local file: ${file.name}`);
    return await file.arrayBuffer();
  }
  const url = urlInput.value.trim();
  log(`Fetching audio from ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status} ${res.statusText}`);
  return await res.arrayBuffer();
}

function chunksToTranscript(
  text: string,
  chunks: { text: string; timestamp: [number, number | null] }[],
): Transcript {
  const segments: TranscriptSegment[] = [];
  if (chunks.length > 0) {
    for (const c of chunks) {
      const trimmed = c.text.trim();
      if (!trimmed) continue;
      const start = c.timestamp[0] ?? 0;
      const end = c.timestamp[1] ?? start;
      segments.push({ start, end, text: trimmed });
    }
  } else if (text.trim()) {
    segments.push({ start: 0, end: 0, text: text.trim() });
  }
  return { language: null, segments };
}

runBtn.addEventListener("click", async () => {
  runBtn.disabled = true;
  statusEl.textContent = "";
  metricsEl.textContent = "";
  outputEl.textContent = "";
  downloadBtn.disabled = true;
  currentTranscript = null;
  window.__spikeResult = undefined;

  try {
    const modelId = modelSelect.value;
    const dtype = dtypeSelect.value;

    const arrayBuffer = await loadAudio();
    log("Decoding + resampling to 16kHz mono…");
    const { audio, durationS } = await decodeTo16kMono(arrayBuffer);
    log(`Decoded ${durationS.toFixed(1)}s of audio (${audio.length} samples).`);

    if (worker) {
      worker.terminate();
    }
    worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });

    const result = await new Promise<{ text: string; chunks: { text: string; timestamp: [number, number | null] }[]; loadMs: number; transcribeMs: number }>(
      (resolve, reject) => {
        let loadMs = 0;
        worker!.onmessage = (ev: MessageEvent<WorkerMessage>) => {
          const msg = ev.data;
          if (msg.type === "progress") {
            const pct = msg.progress !== undefined ? ` ${msg.progress.toFixed(1)}%` : "";
            log(`[${msg.status}]${msg.file ? ` ${msg.file}` : ""}${pct}`);
          } else if (msg.type === "load-done") {
            loadMs = msg.loadMs;
            log(`Model ready (load: ${loadMs > 0 ? `${(loadMs / 1000).toFixed(1)}s` : "cached, ~0s"}).`);
          } else if (msg.type === "transcribe-progress") {
            log(msg.note);
          } else if (msg.type === "result") {
            resolve({ text: msg.text, chunks: msg.chunks, loadMs, transcribeMs: msg.transcribeMs });
          } else if (msg.type === "error") {
            reject(new Error(msg.message));
          }
        };
        worker!.onerror = (e) => reject(new Error(e.message));

        const req: RunRequest = { type: "run", modelId, dtype, device: preferredDevice, audio };
        worker!.postMessage(req, [audio.buffer]);
      },
    );

    const transcript = chunksToTranscript(result.text, result.chunks);
    currentTranscript = transcript;

    const metrics: Metrics = {
      modelId,
      dtype,
      device: preferredDevice,
      loadMs: result.loadMs,
      transcribeMs: result.transcribeMs,
      audioDurationS: durationS,
      realTimeFactor: durationS / (result.transcribeMs / 1000),
    };

    metricsEl.textContent = JSON.stringify(metrics, null, 2);
    outputEl.textContent = JSON.stringify(transcript, null, 2);
    window.__spikeResult = { transcript, metrics };
    downloadBtn.disabled = false;
    log("Done.");
  } catch (err) {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    runBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", () => {
  if (!currentTranscript) return;
  const blob = new Blob([JSON.stringify(currentTranscript, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "transcript.json";
  a.click();
  URL.revokeObjectURL(url);
});
