import { describe, expect, it } from "vitest";
import { windowChunksToSegments } from "./windows";

describe("windowChunksToSegments", () => {
  it("shifts chunk times by the window's offset and closes an open end at the window edge", () => {
    const segs = windowChunksToSegments(
      [
        { text: " Beat the eggs.", timestamp: [0, 4.2] },
        { text: "  ", timestamp: [4.2, 5] },
        { text: " Add rice", timestamp: [20, null] },
      ],
      "",
      60,
      28,
    );
    expect(segs).toEqual([
      { start: 60, end: 64.2, text: "Beat the eggs." },
      { start: 80, end: 88, text: "Add rice" },
    ]);
  });

  it("falls back to the window's whole text when Whisper returns no chunks", () => {
    expect(windowChunksToSegments([], " hello ", 30, 30)).toEqual([{ start: 30, end: 60, text: "hello" }]);
    expect(windowChunksToSegments([], "  ", 30, 30)).toEqual([]);
  });
});
