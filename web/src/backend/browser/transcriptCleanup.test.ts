import { describe, expect, it } from "vitest";
import type { TranscriptSegment } from "@recipe/shared";
import { cleanTranscriptSegments } from "./transcriptCleanup";

function seg(start: number, end: number, text: string): TranscriptSegment {
  return { start, end, text };
}

describe("cleanTranscriptSegments", () => {
  it("drops segments that are only a bracketed non-speech tag", () => {
    const out = cleanTranscriptSegments([
      seg(0, 2, "Add the eggs."),
      seg(2, 4, "[MUSIC]"),
      seg(4, 6, "(upbeat music)"),
      seg(6, 8, "[OUTRO MUSIC PLAYING]"),
      seg(8, 10, "Stir the rice."),
    ]);
    expect(out.map((s) => s.text)).toEqual(["Add the eggs.", "Stir the rice."]);
  });

  it("collapses a segment whose text repeats the previous one, case/punct-insensitive", () => {
    const out = cleanTranscriptSegments([
      seg(0, 4, "The eggs are beaten."),
      seg(4, 8, "the eggs are beaten"),
      seg(8, 12, "THE EGGS ARE BEATEN!!"),
      seg(12, 16, "Now add the scallions."),
    ]);
    expect(out.map((s) => s.text)).toEqual(["The eggs are beaten.", "Now add the scallions."]);
  });

  it("collapses an unbounded run of identical repeated segments (e.g. an outro-music hallucination loop)", () => {
    const segments = [seg(0, 4, "That's the recipe, enjoy!")];
    for (let i = 0; i < 50; i++) {
      segments.push(seg(4 + i, 5 + i, "[OUTRO MUSIC PLAYING]"));
    }
    const out = cleanTranscriptSegments(segments);
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe("That's the recipe, enjoy!");
  });

  it("trims a run of a short token repeated many times within a segment (garbage glitch tokens)", () => {
    const out = cleanTranscriptSegments([
      seg(0, 5, "Add a splash of oil to the pan"),
      seg(5, 10, "-8 -8 -8 -8 -8 -8 -8 -8 need oil in the pan first"),
      seg(10, 12, "Then crack the eggs."),
    ]);
    expect(out.map((s) => s.text)).toEqual([
      "Add a splash of oil to the pan",
      "-8 need oil in the pan first",
      "Then crack the eggs.",
    ]);
  });

  it("trims a run of a repeated word (e.g. 'la la la la la la')", () => {
    const out = cleanTranscriptSegments([seg(0, 3, "la la la la la la la la")]);
    expect(out.map((s) => s.text)).toEqual(["la"]);
  });

  it("does not collapse a short, legitimate repeat below the run threshold", () => {
    const out = cleanTranscriptSegments([seg(0, 3, "very very good, that's the trick")]);
    expect(out.map((s) => s.text)).toEqual(["very very good, that's the trick"]);
  });

  it("drops segments that become empty after cleanup", () => {
    const out = cleanTranscriptSegments([seg(0, 1, "   "), seg(1, 2, "Mix well.")]);
    expect(out.map((s) => s.text)).toEqual(["Mix well."]);
  });

  it("does not collapse similar-but-different consecutive segments", () => {
    const out = cleanTranscriptSegments([
      seg(0, 2, "Add two cups of flour."),
      seg(2, 4, "Add two cups of sugar."),
    ]);
    expect(out).toHaveLength(2);
  });

  it("preserves start/end timestamps of kept segments", () => {
    const out = cleanTranscriptSegments([seg(1.5, 3.25, "Preheat the oven.")]);
    expect(out[0]).toEqual({ start: 1.5, end: 3.25, text: "Preheat the oven." });
  });

  it("returns an empty array for an empty input", () => {
    expect(cleanTranscriptSegments([])).toEqual([]);
  });
});
