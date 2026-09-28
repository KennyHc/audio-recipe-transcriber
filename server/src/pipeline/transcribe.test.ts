import { describe, it, expect } from "vitest";
import { parseWhisperJson } from "./transcribe";

describe("transcribe - whisper JSON parsing", () => {
  it("converts milliseconds to seconds in offsets", () => {
    const whisperOutput = {
      result: { language: "en" },
      transcription: [
        {
          offsets: { from: 1000, to: 2000 },
          text: "Hello world",
        },
      ],
    };

    const result = parseWhisperJson(whisperOutput);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].start).toBe(1);
    expect(result.segments[0].end).toBe(2);
    expect(result.segments[0].text).toBe("Hello world");
  });

  it("trims text and skips empty segments", () => {
    const whisperOutput = {
      result: { language: "en" },
      transcription: [
        { offsets: { from: 0, to: 1000 }, text: "  First   " },
        { offsets: { from: 1000, to: 2000 }, text: "   " }, // will be trimmed to empty
        { offsets: { from: 2000, to: 3000 }, text: "Third" },
      ],
    };

    const result = parseWhisperJson(whisperOutput);

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].text).toBe("First");
    expect(result.segments[1].text).toBe("Third");
  });

  it("handles missing language as null", () => {
    const whisperOutput = {
      result: {},
      transcription: [{ offsets: { from: 0, to: 1000 }, text: "test" }],
    };

    const result = parseWhisperJson(whisperOutput);

    expect(result.language).toBeNull();
  });

  it("returns empty segments array for missing transcription", () => {
    const whisperOutput = {
      result: { language: "en" },
    };

    const result = parseWhisperJson(whisperOutput);

    expect(result.segments).toEqual([]);
  });

  it("skips segments with missing or invalid offsets", () => {
    const whisperOutput = {
      result: { language: "en" },
      transcription: [
        { offsets: { from: 0, to: 1000 }, text: "valid" },
        { offsets: { from: "string" as any, to: 2000 }, text: "invalid from" },
        { offsets: { from: 2000 }, text: "missing to" },
        { text: "missing offsets" },
        { offsets: { from: 3000, to: 4000 }, text: "valid2" },
      ],
    };

    const result = parseWhisperJson(whisperOutput);

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].text).toBe("valid");
    expect(result.segments[1].text).toBe("valid2");
  });

  it("handles realistic whisper.cpp output", () => {
    const whisperOutput = {
      systeminfo: "...",
      model: "...",
      params: "...",
      result: { language: "en", language_probability: 0.98 },
      transcription: [
        {
          offsets: { from: 0, to: 1500 },
          text: "Add two cups of flour",
        },
        {
          offsets: { from: 1500, to: 3200 },
          text: "Mix in eggs and sugar",
        },
        {
          offsets: { from: 3200, to: 5800 },
          text: "Bake at three fifty degrees Fahrenheit",
        },
      ],
    };

    const result = parseWhisperJson(whisperOutput);

    expect(result.language).toBe("en");
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toEqual({
      start: 0,
      end: 1.5,
      text: "Add two cups of flour",
    });
    expect(result.segments[1]).toEqual({
      start: 1.5,
      end: 3.2,
      text: "Mix in eggs and sugar",
    });
    expect(result.segments[2]).toEqual({
      start: 3.2,
      end: 5.8,
      text: "Bake at three fifty degrees Fahrenheit",
    });
  });

  it("handles segments with no text field", () => {
    const whisperOutput = {
      result: { language: "en" },
      transcription: [
        { offsets: { from: 0, to: 1000 } }, // no text field
        { offsets: { from: 1000, to: 2000 }, text: "has text" },
      ],
    };

    const result = parseWhisperJson(whisperOutput);

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe("has text");
  });
});
