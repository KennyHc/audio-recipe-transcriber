import { MAX_TRANSCRIPT_CHARS, type Transcript } from "@recipe/shared";
import type { z } from "zod";
import { appError } from "./errors";

export const KB = 1024;
export const MB = 1024 * KB;
/** /import carries whole libraries (no audio); everything else is one transcript. */
export const IMPORT_BODY_LIMIT_BYTES = 10 * MB;
export const DEFAULT_BODY_LIMIT_BYTES = 1 * MB;
/** Publish/report/admin bodies: a few small fields. */
export const PUBLIC_BODY_LIMIT_BYTES = 64 * KB;

/** Same shape the contract requires for CreateRecipeRequest.id — also a safe Firestore doc id. */
export const RECIPE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Total characters across all transcript segments (the size the limit applies to). */
export function transcriptChars(transcript: Transcript): number {
  return transcript.segments.reduce((sum, s) => sum + s.text.length, 0);
}

export function isTranscriptTooLarge(transcript: Transcript): boolean {
  return transcriptChars(transcript) > MAX_TRANSCRIPT_CHARS;
}

export function assertTranscriptSizeOrThrow(transcript: Transcript): void {
  if (isTranscriptTooLarge(transcript)) throw appError("too_large");
}

export function parseBodyOrThrow<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw appError("bad_request");
  return result.data;
}

const TOO_LARGE_BODY = "This request is too large.";

/**
 * Reads and JSON-parses a request body, refusing more than `maxBytes` — checked against
 * Content-Length up front and again while streaming (the header can be absent or lie).
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw appError("too_large", null, TOO_LARGE_BODY);
  if (!request.body) throw appError("bad_request");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw appError("too_large", null, TOO_LARGE_BODY);
    }
    chunks.push(value);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw appError("bad_request");
  }
}
