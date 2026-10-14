import { describe, expect, it } from "vitest";
import { readDeviceFacts, recommendSpeechModel, type DeviceFacts } from "./deviceProfile";

const desktop: DeviceFacts = { mobile: false, deviceMemoryGb: 16, saveData: false, webgpu: true };

describe("recommendSpeechModel", () => {
  it("keeps the large model on a capable desktop", () => {
    expect(recommendSpeechModel(desktop)).toEqual({ size: "large", reason: null });
    expect(recommendSpeechModel({ ...desktop, deviceMemoryGb: null }).size).toBe("large"); // Safari/Firefox don't report memory
  });

  it("picks the small model on phones, Data Saver, ≤4 GB, or without WebGPU — with a reason", () => {
    for (const d of [
      { ...desktop, mobile: true },
      { ...desktop, saveData: true },
      { ...desktop, deviceMemoryGb: 4 },
      { ...desktop, webgpu: false },
    ]) {
      const r = recommendSpeechModel(d);
      expect(r.size).toBe("small");
      expect(r.reason).toMatch(/smaller model/);
    }
  });
});

describe("readDeviceFacts", () => {
  it("detects phones from UA hints, including iPadOS's desktop UA", () => {
    expect(readDeviceFacts({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148" }).mobile).toBe(true);
    expect(readDeviceFacts({ userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/141 Mobile Safari/537.36" }).mobile).toBe(true);
    expect(readDeviceFacts({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605", maxTouchPoints: 5 }).mobile).toBe(true);
    expect(readDeviceFacts({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141", maxTouchPoints: 0 }).mobile).toBe(false);
    expect(readDeviceFacts({ userAgentData: { mobile: true } }).mobile).toBe(true);
  });

  it("reads memory, Data Saver, and WebGPU defensively", () => {
    expect(readDeviceFacts({ deviceMemory: 8, connection: { saveData: true }, gpu: {} })).toMatchObject({
      deviceMemoryGb: 8,
      saveData: true,
      webgpu: true,
    });
    expect(readDeviceFacts({ deviceMemory: "lots" })).toMatchObject({ deviceMemoryGb: null, saveData: false, webgpu: false });
    expect(readDeviceFacts(undefined)).toEqual({ mobile: false, deviceMemoryGb: null, saveData: false, webgpu: false });
  });
});
