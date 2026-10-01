import { ExtractRequest, MAX_TRANSCRIPT_CHARS } from "@recipe/shared";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors";
import { assertTranscriptSizeOrThrow, isTranscriptTooLarge, parseBodyOrThrow, transcriptChars } from "../src/validation";

function transcriptOfLength(totalChars: number) {
  return { language: "en", segments: [{ start: 0, end: 1, text: "a".repeat(totalChars) }] };
}

describe("transcriptChars", () => {
  it("sums text length across all segments", () => {
    const transcript = {
      language: "en",
      segments: [
        { start: 0, end: 1, text: "abc" },
        { start: 1, end: 2, text: "de" },
      ],
    };
    expect(transcriptChars(transcript)).toBe(5);
  });
});

describe("isTranscriptTooLarge / assertTranscriptSizeOrThrow", () => {
  it("allows exactly the cap", () => {
    const transcript = transcriptOfLength(MAX_TRANSCRIPT_CHARS);
    expect(isTranscriptTooLarge(transcript)).toBe(false);
    expect(() => assertTranscriptSizeOrThrow(transcript)).not.toThrow();
  });

  it("rejects one char over the cap with a too_large AppError", () => {
    const transcript = transcriptOfLength(MAX_TRANSCRIPT_CHARS + 1);
    expect(isTranscriptTooLarge(transcript)).toBe(true);
    try {
      assertTranscriptSizeOrThrow(transcript);
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("too_large");
      expect((err as AppError).status).toBe(413);
    }
  });
});

describe("parseBodyOrThrow", () => {
  it("returns parsed data for a valid body", () => {
    const raw = { transcript: { language: "en", segments: [] } };
    expect(parseBodyOrThrow(ExtractRequest, raw)).toEqual(raw);
  });

  it("throws a bad_request AppError for an invalid body", () => {
    try {
      parseBodyOrThrow(ExtractRequest, { transcript: { language: "en" } });
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("bad_request");
      expect((err as AppError).status).toBe(400);
    }
  });

  it("throws bad_request for completely unrelated JSON", () => {
    expect(() => parseBodyOrThrow(ExtractRequest, { foo: "bar" })).toThrow(AppError);
  });
});
