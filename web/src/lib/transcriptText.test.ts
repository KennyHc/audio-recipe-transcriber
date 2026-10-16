// Tests for shared/transcriptText.ts (pasted captions → Transcript).
import { describe, expect, it } from "vitest";
import {
  detectTranscriptTextFormat,
  isUntimedTranscript,
  parseTranscriptText,
  stripTimestampsIfUntimed,
  TranscriptTextError,
  type ExtractedRecipe,
} from "@recipe/shared";

describe("parseTranscriptText", () => {
  it("parses a transcript copied from YouTube (stamp lines, spoken-time lines, multi-line text)", () => {
    const text = [
      "0:00",
      "0 seconds",
      "hey everyone today we're making",
      "egg fried rice",
      "0:12",
      "12 seconds",
      "crack four eggs into a bowl",
      "1:05",
      "1 minute, 5 seconds",
      "add two cups of cold rice",
    ].join("\n");
    const { transcript, format, timed } = parseTranscriptText(text);
    expect(format).toBe("youtube");
    expect(timed).toBe(true);
    expect(transcript.segments).toEqual([
      { start: 0, end: 12, text: "hey everyone today we're making egg fried rice" },
      { start: 12, end: 65, text: "crack four eggs into a bowl" },
      { start: 65, end: 70, text: "add two cups of cold rice" },
    ]);
  });

  it("parses YouTube's single-line 'stamp text' copy and hour stamps", () => {
    const { transcript } = parseTranscriptText("0:03 heat the wok\n1:00:02 serve hot");
    expect(transcript.segments.map((s) => [s.start, s.text])).toEqual([
      [3, "heat the wok"],
      [3602, "serve hot"],
    ]);
  });

  it("parses SRT", () => {
    const srt = "1\n00:00:01,500 --> 00:00:04,000\nTwo cloves of garlic,\nminced.\n\n2\n00:00:04,000 --> 00:00:06,250\n<i>Fry until golden</i>\n";
    const { transcript, format } = parseTranscriptText(srt);
    expect(format).toBe("srt");
    expect(transcript.segments).toEqual([
      { start: 1.5, end: 4, text: "Two cloves of garlic, minced." },
      { start: 4, end: 6.25, text: "Fry until golden" },
    ]);
  });

  it("parses VTT and collapses rolling auto-captions", () => {
    const vtt = [
      "WEBVTT",
      "Kind: captions",
      "",
      "00:00:00.000 --> 00:00:02.000 align:start position:0%",
      "add<00:00:00.500><c> the</c><00:00:01.000><c> soy sauce</c>",
      "",
      "00:00:02.000 --> 00:00:04.000",
      "add the soy sauce",
      "",
      "00:00:04.000 --> 00:00:06.000",
      "add the soy sauce and toss",
      "",
      "00:06.000 --> 00:08.000",
      "[Music]",
    ].join("\n");
    const { transcript, format } = parseTranscriptText(vtt);
    expect(format).toBe("vtt");
    expect(transcript.segments).toEqual([
      { start: 0, end: 4, text: "add the soy sauce" },
      { start: 4, end: 6, text: "and toss" },
    ]);
  });

  it("parses plain text into untimed, sentence-sized segments", () => {
    const { transcript, format, timed } = parseTranscriptText(
      "Crack four eggs. Whisk them well!\n\nAdd the rice and toss for two minutes.",
    );
    expect(format).toBe("plain");
    expect(timed).toBe(false);
    expect(transcript.segments).toEqual([
      { start: 0, end: 0, text: "Crack four eggs. Whisk them well! Add the rice and toss for two minutes." },
    ]);
    expect(isUntimedTranscript(transcript)).toBe(true);
  });

  it("keeps long plain text in segments of a few sentences", () => {
    const long = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i + 1} about stirring the pot slowly.`).join(" ");
    const { transcript } = parseTranscriptText(long);
    expect(transcript.segments.length).toBeGreaterThan(2);
    expect(transcript.segments.every((s) => s.text.length <= 300)).toBe(true);
  });

  it("rejects text with no words", () => {
    expect(() => parseTranscriptText("   \n\n  ")).toThrow(TranscriptTextError);
    expect(() => parseTranscriptText("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n[Music]\n")).toThrow(TranscriptTextError);
  });

  it("doesn't mistake a recipe with a time in it for a YouTube transcript", () => {
    expect(detectTranscriptTextFormat("Bake at 180C for 25 minutes.\nRest 5:00 before slicing.\nServe warm.")).toBe("plain");
  });
});

describe("stripTimestampsIfUntimed", () => {
  const recipe: ExtractedRecipe = {
    title: "Rice",
    description: null,
    servings: null,
    totalTimeMinutes: null,
    ingredients: [{ quantity: 2, unit: "cup", item: "rice", prep: null, sourceText: "two cups", timestamp: 0, confidence: "stated" }],
    steps: [{ text: "Toss.", timestamp: 0, durationMinutes: null, temperature: null }],
    tips: [{ text: "Use cold rice.", timestamp: 0 }],
  };

  it("clears timestamps for an untimed transcript", () => {
    const out = stripTimestampsIfUntimed(recipe, { language: null, segments: [{ start: 0, end: 0, text: "x" }] });
    expect(out.ingredients[0]!.timestamp).toBeNull();
    expect(out.steps[0]!.timestamp).toBeNull();
    expect(out.tips[0]!.timestamp).toBeNull();
  });

  it("leaves a timed transcript's recipe alone", () => {
    const timed = { language: null, segments: [{ start: 0, end: 3, text: "x" }] };
    expect(stripTimestampsIfUntimed(recipe, timed)).toBe(recipe);
  });
});
