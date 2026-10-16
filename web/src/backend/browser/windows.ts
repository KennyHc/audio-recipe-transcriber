// Whisper output (transformers.js chunks) → Transcript segments in clip time.
// (Per-window transcription with mid-clip checkpoints was tried and dropped: Whisper skipped
// whole spoken stretches on separate windows that the overlapping whole-clip run keeps — see
// transcribe.ts.)

import type { TranscriptSegment } from "@recipe/shared";

export const SAMPLE_RATE = 16_000;
export interface WindowChunk {
  text: string;
  timestamp: [number, number | null];
}

/**
 * A window's chunks (timestamps relative to the window) → segments in clip time. A chunk
 * without an end (Whisper cut off at the window edge) ends at the window's end; nothing ends
 * past the window.
 */
export function windowChunksToSegments(
  chunks: WindowChunk[],
  fallbackText: string,
  offsetSeconds: number,
  windowSeconds: number,
): TranscriptSegment[] {
  const round = (n: number) => Math.round(n * 100) / 100;
  if (chunks.length === 0) {
    const trimmed = fallbackText.trim();
    return trimmed ? [{ start: round(offsetSeconds), end: round(offsetSeconds + windowSeconds), text: trimmed }] : [];
  }
  const segments: TranscriptSegment[] = [];
  for (const c of chunks) {
    const text = c.text.trim();
    if (!text) continue;
    const relStart = Math.min(Math.max(0, c.timestamp[0] ?? 0), windowSeconds);
    const relEnd = Math.min(Math.max(relStart, c.timestamp[1] ?? windowSeconds), windowSeconds);
    segments.push({ start: round(offsetSeconds + relStart), end: round(offsetSeconds + relEnd), text });
  }
  return segments;
}
