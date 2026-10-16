import { describe, expect, it } from "vitest";
import { MAX_TRANSCRIPT_CHARS } from "@recipe/shared";
import { analyzeCaptions, captionsJobFileName, hasCaptionFileExtension, isCaptionsJob, parseCaptionsOrThrow, PASTED_CAPTIONS_FILE_NAME } from "./captions";

const youtube = "0:00\nToday we make egg fried rice\n0:04\nTwo eggs into the bowl\n0:09\nBeat them well";

describe("analyzeCaptions", () => {
  it("counts timed lines and says steps will link to the video (cloud)", () => {
    const a = analyzeCaptions(youtube, { linksToVideo: true });
    expect(a.kind).toBe("ok");
    if (a.kind !== "ok") return;
    expect(a.lines).toBe(3);
    expect(a.parsed.timed).toBe(true);
    expect(a.message).toBe("Found 3 lines with timestamps — recipe steps will link to the video");
  });

  it("doesn't promise video links where there is no video link (browser/hosted)", () => {
    const a = analyzeCaptions(youtube);
    expect(a.kind === "ok" && a.message).toBe("Found 3 lines with timestamps");
  });

  it("says plain text has no timestamps", () => {
    const a = analyzeCaptions("Beat two eggs. Fry the rice with soy sauce.", { linksToVideo: true });
    expect(a.kind).toBe("ok");
    expect(a.kind === "ok" && a.parsed.timed).toBe(false);
    expect(a.kind === "ok" && a.message).toMatch(/^No timestamps found — the recipe won't link to moments/);
  });

  it("empty, unusable and too-long text", () => {
    expect(analyzeCaptions("   \n").kind).toBe("empty");
    expect(analyzeCaptions("WEBVTT\n\n").kind).toBe("error");
    const huge = "Stir the pot. ".repeat(Math.ceil(MAX_TRANSCRIPT_CHARS / 13) + 10);
    const a = analyzeCaptions(huge);
    expect(a.kind).toBe("too_long");
    expect(a.kind === "too_long" && a.message).toMatch(/max 40,000/);
  });
});

describe("parseCaptionsOrThrow", () => {
  it("returns the transcript or throws a user-facing message", () => {
    expect(parseCaptionsOrThrow(youtube).transcript.segments[1]).toEqual({ start: 4, end: 9, text: "Two eggs into the bowl" });
    expect(() => parseCaptionsOrThrow("")).toThrow(/Paste the video's transcript/);
    expect(() => parseCaptionsOrThrow("x".repeat(MAX_TRANSCRIPT_CHARS + 1))).toThrow(/more than one recipe's worth/);
  });
});

describe("captions jobs", () => {
  it("are named after the caption file, or 'Pasted captions'", () => {
    expect(captionsJobFileName(null)).toBe(PASTED_CAPTIONS_FILE_NAME);
    expect(captionsJobFileName("  ")).toBe(PASTED_CAPTIONS_FILE_NAME);
    expect(captionsJobFileName("Fried rice.en.vtt")).toBe("Fried rice.en.vtt");
  });

  it("are told apart from audio jobs by the file name", () => {
    expect(isCaptionsJob({ fileName: "Pasted captions" })).toBe(true);
    expect(isCaptionsJob({ fileName: "video.srt" })).toBe(true);
    expect(isCaptionsJob({ fileName: "clip.MP3" })).toBe(false);
    expect(isCaptionsJob({ fileName: "voice memo.m4a" })).toBe(false);
  });

  it("accepts .srt/.vtt/.txt files only", () => {
    expect(hasCaptionFileExtension("a.SRT")).toBe(true);
    expect(hasCaptionFileExtension("a.vtt")).toBe(true);
    expect(hasCaptionFileExtension("a.txt")).toBe(true);
    expect(hasCaptionFileExtension("a.mp3")).toBe(false);
  });
});
