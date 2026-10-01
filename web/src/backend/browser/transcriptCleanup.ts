// Pure post-processing for raw Whisper output before it becomes a Transcript.
// In-browser Whisper models (esp. smaller ones) are prone to well-known
// hallucination/repetition failure modes on silence, music, or noisy audio —
// see web/src/spike/RESULTS.md's "Qualitative observations" for real examples
// from this app's own test clip:
//   - whisper-base: "Two. Two. Three. Two. Three..." (nonsense digit repeats),
//     a duplicated sentence ("The eggs are beaten...") appearing twice, a long
//     garbage run of repeated "-8" tokens, and an unbounded end-of-clip loop
//     of "[OUTRO MUSIC PLAYING]".
//   - whisper-small: "camera... egg sardine... green onion sardine" nonsense,
//     and a duplicated line at the chili-sauce moment.
// This module never talks to the network or the DOM — it's a pure function
// over segments, so it's cheap to test exhaustively.

import type { TranscriptSegment } from "@recipe/shared";

/** Matches a whole-segment non-speech tag like "[MUSIC]", "(upbeat music)",
 * "[OUTRO MUSIC PLAYING]" — the entire trimmed text is bracketed/parenthesized
 * with nothing else in it. */
const BRACKETED_TAG_RE = /^[([][^)\]]*[)\]]$/;

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "") // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapses runs of a short token repeated many times within a single
 * segment's text, e.g. "-8-8-8-8-8-8-8-8" or "la la la la la la la la la".
 * A "token" here is a short run of non-whitespace (<=6 chars, to target
 * garbage/glitch tokens like "-8" rather than legitimately repeated words).
 * Any token repeated MIN_RUN_LENGTH+ times consecutively is collapsed to a
 * single occurrence. */
const MIN_RUN_LENGTH = 4;

function collapseRepeatedTokenRuns(text: string): string {
  const tokens = text.split(/(\s+)/); // keep whitespace so we can rejoin faithfully
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    // Only whitespace: pass through.
    if (/^\s*$/.test(tok)) {
      out.push(tok);
      i++;
      continue;
    }
    // Count how many times this exact token (word) repeats, skipping the
    // whitespace between repetitions.
    let runLength = 1;
    let j = i + 2; // skip tok, then its trailing whitespace
    while (j < tokens.length && /^\s*$/.test(tokens[i + 1] ?? "") && tokens[j] === tok) {
      runLength++;
      j += 2;
    }
    if (runLength >= MIN_RUN_LENGTH && tok.replace(/[^\p{L}\p{N}]/gu, "").length <= 6) {
      out.push(tok);
    } else {
      // Emit the whole run as-is.
      for (let k = i; k < i + (runLength - 1) * 2 + 1; k++) {
        out.push(tokens[k]);
      }
    }
    i += (runLength - 1) * 2 + 1;
  }
  return out.join("").trim();
}

/**
 * Cleans a list of raw transcript segments:
 *  - drops segments that are only a bracketed/parenthesized non-speech tag
 *    ("[MUSIC]", "(upbeat music)", "[OUTRO MUSIC PLAYING]");
 *  - collapses a segment whose (normalized) text is identical to the
 *    previous kept segment's, case/punctuation-insensitive;
 *  - trims runs of a short token repeated many times within a segment;
 *  - drops segments that end up empty after cleanup.
 * Pure: no side effects, same input always produces the same output.
 */
export function cleanTranscriptSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let lastKeptNormalized: string | null = null;

  for (const raw of segments) {
    const trimmed = raw.text.trim();
    if (!trimmed) continue;
    if (BRACKETED_TAG_RE.test(trimmed)) continue;

    const collapsedText = collapseRepeatedTokenRuns(trimmed);
    if (!collapsedText) continue;

    const normalized = normalizeForCompare(collapsedText);
    if (!normalized) continue;
    if (normalized === lastKeptNormalized) continue; // repeats the previous segment

    out.push({ ...raw, text: collapsedText });
    lastKeptNormalized = normalized;
  }

  return out;
}
