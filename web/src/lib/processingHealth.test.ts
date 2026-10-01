import { describe, expect, it } from "vitest";
import { formatProcessingSummary } from "./processingHealth";

describe("formatProcessingSummary", () => {
  it("matches the full shape when every stage ran", () => {
    const line = formatProcessingSummary({
      downloadMs: 142_000,
      transcribeMs: 71_000,
      audioSeconds: 456,
      hiddenSeconds: 0,
    });
    expect(line).toBe("[recipe-transcriber] download 142s · transcribe 71s for 456s audio · tab hidden 0s");
  });

  it("omits the download segment when the model was already cached (no download stage)", () => {
    const line = formatProcessingSummary({
      downloadMs: null,
      transcribeMs: 30_000,
      audioSeconds: 120,
      hiddenSeconds: 5,
    });
    expect(line).toBe("[recipe-transcriber] transcribe 30s for 120s audio · tab hidden 5s");
  });

  it("omits the transcribe segment (and its audio length) when transcription never ran", () => {
    const line = formatProcessingSummary({
      downloadMs: 90_000,
      transcribeMs: null,
      audioSeconds: null,
      hiddenSeconds: 0,
    });
    expect(line).toBe("[recipe-transcriber] download 90s · tab hidden 0s");
  });

  it("always includes tab-hidden seconds, rounded", () => {
    const line = formatProcessingSummary({
      downloadMs: null,
      transcribeMs: null,
      audioSeconds: null,
      hiddenSeconds: 12.6,
    });
    expect(line).toBe("[recipe-transcriber] tab hidden 13s");
  });
});
