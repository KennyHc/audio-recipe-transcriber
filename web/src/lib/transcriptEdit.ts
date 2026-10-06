// Pure helpers for the transcript-editing flow (TranscriptView's edit mode). Kept
// side-effect-free so they're cheap to test exhaustively: no network, no DOM.
//
// Editing never adds, removes, or reorders segments, and never changes a segment's
// start/end — only text changes, aligned 1:1 by index with the original
// `transcript.segments`. An empty (post-trim) segment is allowed while editing (the
// user emptied it out) and is simply dropped when the transcript is actually saved.

import type { Transcript, TranscriptSegment } from "@recipe/shared";

/** The set of segment indices (into the ORIGINAL segment array) whose edited text
 * differs from the original, trimmed. `edited` is the in-progress per-segment text,
 * same length/order as `original`. */
export function changedSegmentIndices(
  original: readonly TranscriptSegment[],
  edited: readonly string[],
): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < original.length; i++) {
    if ((edited[i] ?? "").trim() !== original[i]!.text.trim()) out.add(i);
  }
  return out;
}

/** True if any segment's edited text differs from the original (trimmed). Used to
 * decide whether "Cancel" needs a confirmation before discarding. */
export function hasUnsavedTranscriptEdits(
  original: readonly TranscriptSegment[],
  edited: readonly string[],
): boolean {
  return changedSegmentIndices(original, edited).size > 0;
}

/** Builds the Transcript to send to `putTranscript`: keeps each kept segment's
 * original start/end, swaps in the (trimmed) edited text, and drops any segment
 * that ends up empty after trimming. */
export function buildEditedTranscript(
  transcript: Transcript,
  edited: readonly string[],
): Transcript {
  const segments: TranscriptSegment[] = [];
  transcript.segments.forEach((seg, i) => {
    const text = (edited[i] ?? "").trim();
    if (!text) return;
    segments.push({ start: seg.start, end: seg.end, text });
  });
  return { ...transcript, segments };
}
