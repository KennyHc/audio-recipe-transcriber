import { describe, expect, it } from "vitest";
import { estimateSecondsLeft, formatTimeLeft, priorSecondsPerAudioSecond } from "./transcriptionEta";

describe("priorSecondsPerAudioSecond", () => {
  it("small model ≈ real time without WebGPU (phones); large ≈ 6× faster than real time with WebGPU", () => {
    expect(priorSecondsPerAudioSecond({ modelId: "onnx-community/whisper-small", webgpu: false })).toBe(1);
    expect(priorSecondsPerAudioSecond({ modelId: "onnx-community/whisper-large-v3-turbo", webgpu: true })).toBeCloseTo(1 / 6);
    expect(priorSecondsPerAudioSecond({ modelId: "onnx-community/whisper-large-v3-turbo", webgpu: false })).toBeGreaterThan(1);
  });
});

describe("estimateSecondsLeft", () => {
  const base = { totalAudioSeconds: 600, doneAudioSeconds: 0, measuredAudioSeconds: 0, measuredMs: 0, prior: 1 };

  it("uses the prior before anything is measured", () => {
    expect(estimateSecondsLeft(base)).toBe(600);
    expect(estimateSecondsLeft({ ...base, prior: 1 / 6 })).toBeCloseTo(100);
  });

  it("only counts what's left (resumed audio included in done)", () => {
    expect(estimateSecondsLeft({ ...base, doneAudioSeconds: 450 })).toBe(150);
    expect(estimateSecondsLeft({ ...base, doneAudioSeconds: 600 })).toBe(0);
  });

  it("refines from observed speed, fully trusting it after ~2 minutes of audio", () => {
    // 150 s of audio took 75 s → 0.5 s per audio second; 300 s left → 150 s.
    expect(estimateSecondsLeft({ ...base, doneAudioSeconds: 300, measuredAudioSeconds: 150, measuredMs: 75_000 })).toBeCloseTo(150);
    // 30 s measured at 2 s/s, prior 1: weight 0.25 → rate 1.25; 570 s left.
    expect(estimateSecondsLeft({ ...base, doneAudioSeconds: 30, measuredAudioSeconds: 30, measuredMs: 60_000 })).toBeCloseTo(570 * 1.25);
  });

  it("is unknown without a duration", () => {
    expect(estimateSecondsLeft({ ...base, totalAudioSeconds: 0 })).toBeNull();
  });
});

describe("formatTimeLeft", () => {
  it("rounds minutes up and says less than a minute at the end", () => {
    expect(formatTimeLeft(241)).toBe("Keep this tab open — about 5 min left");
    expect(formatTimeLeft(60)).toBe("Keep this tab open — about 1 min left");
    expect(formatTimeLeft(12)).toBe("Keep this tab open — less than a minute left");
    expect(formatTimeLeft(null)).toBe("Keep this tab open until it's done.");
  });
});
