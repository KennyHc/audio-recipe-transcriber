import { describe, expect, it } from "vitest";
import type { Transcript, TranscriptSegment } from "@recipe/shared";
import { buildEditedTranscript, changedSegmentIndices, hasUnsavedTranscriptEdits } from "./transcriptEdit";

function seg(start: number, end: number, text: string): TranscriptSegment {
  return { start, end, text };
}

function transcript(segments: TranscriptSegment[]): Transcript {
  return { language: "en", segments };
}

describe("changedSegmentIndices", () => {
  it("returns an empty set when nothing changed", () => {
    const original = [seg(0, 2, "Chop four green onions."), seg(2, 4, "Add the eggs.")];
    const out = changedSegmentIndices(original, ["Chop four green onions.", "Add the eggs."]);
    expect(out.size).toBe(0);
  });

  it("flags only the indices whose text differs", () => {
    const original = [seg(0, 2, "Chop all green onions."), seg(2, 4, "Add the eggs."), seg(4, 6, "Stir.")];
    const out = changedSegmentIndices(original, ["Chop four green onions.", "Add the eggs.", "Stir well."]);
    expect(out).toEqual(new Set([0, 2]));
  });

  it("ignores whitespace-only differences", () => {
    const original = [seg(0, 2, "Add the eggs.")];
    const out = changedSegmentIndices(original, ["  Add the eggs.  "]);
    expect(out.size).toBe(0);
  });

  it("flags a segment emptied out by the user", () => {
    const original = [seg(0, 2, "Add the eggs."), seg(2, 4, "Stir.")];
    const out = changedSegmentIndices(original, ["", "Stir."]);
    expect(out).toEqual(new Set([0]));
  });
});

describe("hasUnsavedTranscriptEdits", () => {
  it("is false when nothing changed", () => {
    const original = [seg(0, 2, "Add the eggs.")];
    expect(hasUnsavedTranscriptEdits(original, ["Add the eggs."])).toBe(false);
  });

  it("is true when any segment changed", () => {
    const original = [seg(0, 2, "Add the eggs."), seg(2, 4, "Stir.")];
    expect(hasUnsavedTranscriptEdits(original, ["Add the eggs.", "Stir well."])).toBe(true);
  });
});

describe("buildEditedTranscript", () => {
  it("swaps in edited text but keeps original start/end", () => {
    const t = transcript([seg(1.5, 3.25, "Chop all green onions.")]);
    const out = buildEditedTranscript(t, ["Chop four green onions."]);
    expect(out.segments).toEqual([seg(1.5, 3.25, "Chop four green onions.")]);
    expect(out.language).toBe("en");
  });

  it("trims edited text", () => {
    const t = transcript([seg(0, 2, "Add the eggs.")]);
    const out = buildEditedTranscript(t, ["  Add the eggs, beaten.  "]);
    expect(out.segments[0]?.text).toBe("Add the eggs, beaten.");
  });

  it("drops segments that become empty after trimming", () => {
    const t = transcript([seg(0, 2, "Um."), seg(2, 4, "Add the eggs."), seg(4, 6, "Uh.")]);
    const out = buildEditedTranscript(t, ["   ", "Add the eggs.", ""]);
    expect(out.segments).toEqual([seg(2, 4, "Add the eggs.")]);
  });

  it("preserves segment order", () => {
    const t = transcript([seg(0, 2, "One."), seg(2, 4, "Two."), seg(4, 6, "Three.")]);
    const out = buildEditedTranscript(t, ["One.", "Two edited.", "Three."]);
    expect(out.segments.map((s) => s.text)).toEqual(["One.", "Two edited.", "Three."]);
  });

  it("returns an empty segment list when every segment is emptied", () => {
    const t = transcript([seg(0, 2, "Um."), seg(2, 4, "Uh.")]);
    const out = buildEditedTranscript(t, ["", ""]);
    expect(out.segments).toEqual([]);
  });
});
