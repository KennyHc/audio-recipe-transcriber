// "Paste captions instead": the UI-side helpers around shared/transcriptText.ts — parsing what
// the visitor pasted (or the caption file they picked) into a Transcript, the live feedback line,
// the size cap, and telling a captions job apart from an audio one.
//
// A captions job is recognizable everywhere — on any device, in any mode — by its file name:
// audio uploads always end in an audio extension (the upload refuses anything else), while a
// captions job is named "Pasted captions" or after its .srt/.vtt/.txt file.

import {
  MAX_TRANSCRIPT_CHARS,
  parseTranscriptText,
  TranscriptTextError,
  type ParsedTranscriptText,
  type Transcript,
} from "@recipe/shared";

export const PASTED_CAPTIONS_FILE_NAME = "Pasted captions";
export const CAPTION_FILE_EXTENSIONS = [".srt", ".vtt", ".txt"];
/** Caption files carry timing markup on top of the words, so allow well over the text cap. */
export const MAX_CAPTION_FILE_BYTES = 2 * 1024 * 1024;

const AUDIO_EXTENSION = /\.(mp3|m4a|wav|webm|ogg|mp4|aac|flac)$/i;

export function isCaptionsJob(job: { fileName: string }): boolean {
  return !AUDIO_EXTENSION.test(job.fileName.trim());
}

export function hasCaptionFileExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return CAPTION_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** The job's name: the caption file's name, or "Pasted captions". */
export function captionsJobFileName(fileName: string | null | undefined): string {
  const name = (fileName ?? "").trim();
  return name ? name.slice(0, 300) : PASTED_CAPTIONS_FILE_NAME;
}

/** Same measure as the API's size cap (api/src/validation.ts): characters across segments. */
export function transcriptChars(transcript: Transcript): number {
  return transcript.segments.reduce((sum, s) => sum + s.text.length, 0);
}

export type CaptionsAnalysis =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "too_long"; chars: number; message: string }
  | { kind: "ok"; parsed: ParsedTranscriptText; lines: number; chars: number; message: string };

export function tooLongMessage(chars: number): string {
  return `That's ${chars.toLocaleString("en-US")} characters — more than one recipe's worth (max ${MAX_TRANSCRIPT_CHARS.toLocaleString("en-US")}). Paste just the part with the recipe.`;
}

/**
 * Parses pasted text and says what was found, for the live feedback line. `linksToVideo`: the
 * recipe can link its steps to the video (cloud mode, where a video link is kept and published
 * recipes seek the YouTube player); elsewhere the feedback just says timestamps were found.
 */
export function analyzeCaptions(text: string, options: { linksToVideo?: boolean } = {}): CaptionsAnalysis {
  if (!text.trim()) return { kind: "empty" };
  let parsed: ParsedTranscriptText;
  try {
    parsed = parseTranscriptText(text);
  } catch (err) {
    if (err instanceof TranscriptTextError) return { kind: "error", message: err.message };
    return { kind: "error", message: "We couldn't read that text." };
  }
  const chars = transcriptChars(parsed.transcript);
  if (chars > MAX_TRANSCRIPT_CHARS) return { kind: "too_long", chars, message: tooLongMessage(chars) };
  const lines = parsed.transcript.segments.length;
  const plural = lines === 1 ? "" : "s";
  const message = parsed.timed
    ? options.linksToVideo
      ? `Found ${lines} line${plural} with timestamps — recipe steps will link to the video`
      : `Found ${lines} line${plural} with timestamps`
    : options.linksToVideo
      ? "No timestamps found — the recipe won't link to moments in the video"
      : "No timestamps found — that's fine, the recipe just won't have times";
  return { kind: "ok", parsed, lines, chars, message };
}

/** For the backends: parse or throw a user-facing Error (bad text, or over the size cap). */
export function parseCaptionsOrThrow(text: string): ParsedTranscriptText {
  const analysis = analyzeCaptions(text);
  switch (analysis.kind) {
    case "ok":
      return analysis.parsed;
    case "empty":
      throw new Error("Paste the video's transcript or captions first.");
    default:
      throw new Error(analysis.message);
  }
}
