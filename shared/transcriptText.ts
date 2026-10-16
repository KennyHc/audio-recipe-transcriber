import type { ExtractedRecipe, Transcript, TranscriptSegment } from "./recipe";

// "Paste captions instead of audio": turns text a cook already has — a YouTube transcript
// copied from the video page, an .srt/.vtt caption file, or plain text — into the same
// Transcript the speech model would produce, so the rest of the pipeline is unchanged and no
// speech model is downloaded. Pure; shared by the web app (all in-browser modes) and tests.
//
// Plain text has no timing. Such a transcript is "untimed": every segment has start = end = 0,
// and the recipe's timestamps are cleared after extraction (stripTimestampsIfUntimed) so the UI
// never shows a meaningless "0:00" link.

export type TranscriptTextFormat = "vtt" | "srt" | "youtube" | "plain";

export interface ParsedTranscriptText {
  transcript: Transcript;
  format: TranscriptTextFormat;
  /** False for plain text: no timestamps to link to. */
  timed: boolean;
}

/** Thrown with a user-facing message when the text holds nothing usable. */
export class TranscriptTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptTextError";
  }
}

const CUE_TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/;
const CUE_LINE = new RegExp(`^\\s*${CUE_TIME.source}\\s*-->\\s*${CUE_TIME.source}`);
/** "0:12", "12:05", "1:02:03" — alone on a line, or followed by the text (YouTube copy). */
const YT_STAMP = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s+(.*))?$/;
/** YouTube's screen-reader line under each stamp: "12 seconds", "1 minute, 5 seconds". */
const YT_SPOKEN_TIME = /^\s*\d+\s+(?:hours?|minutes?|seconds?)(?:,\s*\d+\s+(?:hours?|minutes?|seconds?))*\s*$/i;

function secondsOf(h: string | undefined, m: string, s: string, frac: string | undefined): number {
  const ms = frac ? Number(frac.padEnd(3, "0")) / 1000 : 0;
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + ms;
}

function stampSeconds(stamp: string): number {
  const parts = stamp.split(":").map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Caption markup → plain words: <c>, <i>, <00:00:01.000> karaoke tags, {\an8}, [Music]. */
function cleanCaptionText(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/\[(?:music|applause|laughter|♪+)[^\]]*\]/gi, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Auto-generated captions (YouTube "rolling" cues) repeat the previous line at the start of
 * the next cue. Drop exact repeats and the repeated prefix so the text reads once.
 */
function dedupeRolling(segments: TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    let text = seg.text;
    if (prev) {
      if (text === prev.text) {
        prev.end = Math.max(prev.end, seg.end);
        continue;
      }
      if (text.startsWith(`${prev.text} `)) text = text.slice(prev.text.length + 1);
    }
    if (text) out.push({ ...seg, text });
  }
  return out;
}

function parseCues(lines: string[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = CUE_LINE.exec(lines[i]!);
    if (!m) continue;
    const start = secondsOf(m[1], m[2]!, m[3]!, m[4]);
    const end = secondsOf(m[5], m[6]!, m[7]!, m[8]);
    const text: string[] = [];
    while (i + 1 < lines.length && lines[i + 1]!.trim() !== "" && !CUE_LINE.test(lines[i + 1]!)) {
      text.push(lines[++i]!);
    }
    const cleaned = cleanCaptionText(text.join(" "));
    if (cleaned) segments.push({ start, end: Math.max(end, start), text: cleaned });
  }
  return dedupeRolling(segments);
}

function parseYouTubeCopy(lines: string[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: { start: number; text: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const text = cleanCaptionText(current.text.join(" "));
    if (text) segments.push({ start: current.start, end: current.start, text });
  };
  for (const line of lines) {
    const m = YT_STAMP.exec(line);
    if (m) {
      flush();
      current = { start: stampSeconds(m[1]!), text: m[2] ? [m[2]] : [] };
    } else if (current && line.trim() && !YT_SPOKEN_TIME.test(line)) {
      current.text.push(line);
    }
  }
  flush();
  // Each line ends where the next begins; the last gets a few seconds.
  for (let i = 0; i < segments.length; i++) {
    segments[i]!.end = i + 1 < segments.length ? Math.max(segments[i + 1]!.start, segments[i]!.start) : segments[i]!.start + 5;
  }
  return dedupeRolling(segments);
}

/** Plain text → ~sentence-sized untimed segments (start = end = 0). */
function parsePlain(text: string): TranscriptSegment[] {
  const sentences = text
    .replace(/\r/g, "")
    .split(/(?<=[.!?])\s+|\n{2,}|\n(?=\s*[-•*\d])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const segments: TranscriptSegment[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf && buf.length + s.length > 240) {
      segments.push({ start: 0, end: 0, text: buf });
      buf = "";
    }
    buf = buf ? `${buf} ${s}` : s;
  }
  if (buf) segments.push({ start: 0, end: 0, text: buf });
  return segments;
}

export function detectTranscriptTextFormat(text: string): TranscriptTextFormat {
  const head = text.trimStart();
  if (/^WEBVTT/.test(head)) return "vtt";
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => CUE_LINE.test(l))) return /,\d{3}\s*-->/.test(text) ? "srt" : "vtt";
  const stamped = lines.filter((l) => YT_STAMP.test(l)).length;
  const nonEmpty = lines.filter((l) => l.trim()).length;
  if (stamped >= 2 && stamped >= nonEmpty * 0.2) return "youtube";
  return "plain";
}

export function parseTranscriptText(text: string): ParsedTranscriptText {
  const format = detectTranscriptTextFormat(text);
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const segments =
    format === "vtt" || format === "srt" ? parseCues(lines) : format === "youtube" ? parseYouTubeCopy(lines) : parsePlain(text);
  if (segments.length === 0 || segments.every((s) => s.text.length === 0)) {
    throw new TranscriptTextError("We couldn't find any words in that text. Paste the transcript or captions of the video.");
  }
  return { transcript: { language: null, segments }, format, timed: format !== "plain" };
}

/** A transcript without timing (pasted plain text): every segment at 0–0. */
export function isUntimedTranscript(transcript: Transcript): boolean {
  return transcript.segments.length > 0 && transcript.segments.every((s) => s.start === 0 && s.end === 0);
}

/** Clears timestamps the extractor may have copied from an untimed transcript ("0:00"). */
export function stripTimestampsIfUntimed<T extends ExtractedRecipe>(recipe: T, transcript: Transcript): T {
  if (!isUntimedTranscript(transcript)) return recipe;
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((i) => ({ ...i, timestamp: null })),
    steps: recipe.steps.map((s) => ({ ...s, timestamp: null })),
    tips: recipe.tips.map((t) => ({ ...t, timestamp: null })),
  };
}
