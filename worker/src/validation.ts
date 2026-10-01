import { MAX_TRANSCRIPT_CHARS, type Transcript } from "@recipe/shared";
import type { z } from "zod";
import { appError } from "./errors";

/** Total characters across all transcript segments (the size the limit applies to). */
export function transcriptChars(transcript: Transcript): number {
  return transcript.segments.reduce((sum, s) => sum + s.text.length, 0);
}

export function isTranscriptTooLarge(transcript: Transcript): boolean {
  return transcriptChars(transcript) > MAX_TRANSCRIPT_CHARS;
}

/** Parses `raw` (already-JSON-parsed body) against `schema`, throwing the right AppError on failure. */
export function parseBodyOrThrow<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw appError("bad_request");
  }
  return result.data;
}

/** Throws `too_large` if the transcript embedded in `body` exceeds the cap. */
export function assertTranscriptSizeOrThrow(transcript: Transcript): void {
  if (isTranscriptTooLarge(transcript)) {
    throw appError("too_large");
  }
}
