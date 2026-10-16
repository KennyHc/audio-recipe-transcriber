import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeTo16kMono } from "./audio";
import { transcribeAudio, type WindowProgress } from "./transcribe";
import { SAMPLE_RATE } from "./windows";
import type { RunRequest } from "./whisper.worker";

// transcribeAudio end to end with fakes for the decoder and the Worker (no Web Audio /
// transformers.js in Node). The whole clip goes to the worker in ONE call — transformers.js
// does the overlapping 30 s chunking — because separate per-window runs skipped speech.
vi.mock("./audio", () => ({ decodeTo16kMono: vi.fn() }));

const SECONDS = 95;
const audio = new Float32Array(SECONDS * SAMPLE_RATE).map((_, i) => Math.sin(i / 3) * 0.4);

let calls: number[] = [];
let fail = false;

class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  postMessage(req: RunRequest) {
    calls.push(req.audio.length);
    setTimeout(() => {
      if (fail) {
        this.onmessage?.({ data: { type: "error", message: "GPU device was lost" } } as MessageEvent);
        return;
      }
      this.onmessage?.({ data: { type: "progress", stage: "download", label: "Speech model ready", fraction: 1 } } as MessageEvent);
      this.onmessage?.({
        data: {
          type: "result",
          text: "beat the eggs add rice",
          chunks: [
            { text: " Beat the eggs.", timestamp: [0.5, 4] },
            { text: " Add the rice.", timestamp: [60, null] },
          ],
        },
      } as MessageEvent);
    }, 0);
  }
  terminate() {}
}

beforeEach(() => {
  calls = [];
  fail = false;
  vi.stubGlobal("Worker", FakeWorker);
  vi.mocked(decodeTo16kMono).mockImplementation(async () => ({ audio: audio.slice(), durationS: SECONDS }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const blob = new Blob(["fake"]);

describe("transcribeAudio", () => {
  it("sends the whole clip in one call and maps chunks to clip-time segments", async () => {
    const progress: WindowProgress[] = [];
    const t = await transcribeAudio(blob, "m", "q4", undefined, { onWindowProgress: (p) => progress.push(p) });
    expect(calls).toEqual([SECONDS * SAMPLE_RATE]);
    expect(t.segments.map((s) => [s.start, s.end, s.text])).toEqual([
      [0.5, 4, "Beat the eggs."],
      [60, SECONDS, "Add the rice."], // an open end closes at the end of the clip
    ]);
    expect(progress[0]!.doneSeconds).toBe(0);
    expect(progress[progress.length - 1]!.doneSeconds).toBeCloseTo(SECONDS);
  });

  it("rejects with a TranscriptionError when the worker fails", async () => {
    fail = true;
    await expect(transcribeAudio(blob, "m", "q4")).rejects.toThrow(/GPU|device|transcri/i);
  });
});
