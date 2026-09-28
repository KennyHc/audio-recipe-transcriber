// audio -> ffmpeg (16kHz mono wav) -> whisper-cli -> Transcript
//
// NOTE ON VERIFICATION: the JSON parsing below follows whisper.cpp's documented
// `-oj/--output-json` schema (systeminfo/model/params/result/transcription[],
// each transcription entry carrying "offsets": {from,to} in milliseconds and
// "text"). This was confirmed structurally by actually running whisper-cli
// against whisper.cpp's own bundled test model and sample wav
// (/opt/homebrew/Cellar/whisper.cpp/*/share/whisper.cpp/{for-tests-ggml-tiny.bin,jfk.wav}),
// which produced the systeminfo/model/params/result envelope shown here.
// That test model's weights are dummy/random, though, so it never produced a
// non-empty `transcription` array — the per-segment field names
// (offsets.from/to, text) are taken from whisper.cpp's well-documented output
// format, not observed directly in this environment. Treat the segment
// parsing as unverified against a real model until it's run once for real.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Transcript, TranscriptSegment } from "@recipe/shared";
import { FFMPEG_PATH, WHISPER_CLI_PATH, WHISPER_MODEL_PATH } from "../config.ts";
import { findOriginalAudio, jobDir, saveTranscript } from "../storage.ts";
import { readFile } from "node:fs/promises";

const COOKING_VOCAB_PROMPT =
  "Cooking class transcript. Vocabulary: tablespoon, teaspoon, cup, grams, ounces, pound, " +
  "clove, pinch, dash, sauté, simmer, julienne, dice, mince, braise, deglaze, fold, whisk, " +
  "preheat, marinate, zest, garnish, al dente, Parmesan, olive oil.";

class TranscribeError extends Error {}

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => {
      reject(new TranscribeError(`Failed to run ${command}: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new TranscribeError(`${path.basename(command)} exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
      }
    });
  });
}

async function convertToWav(inputPath: string, outputPath: string): Promise<string> {
  // -y overwrite, -ac 1 mono, -ar 16000 sample rate. Args are passed as an
  // array (no shell string interpolation) so file names can't break out.
  await run(FFMPEG_PATH, ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", outputPath]);
  return outputPath;
}

interface WhisperJsonSegment {
  timestamps?: { from?: string; to?: string };
  offsets?: { from?: number; to?: number };
  text?: string;
}

export interface WhisperJsonOutput {
  result?: { language?: string };
  transcription?: WhisperJsonSegment[];
}

export function parseWhisperJson(raw: WhisperJsonOutput): Transcript {
  const segments: TranscriptSegment[] = [];
  for (const entry of raw.transcription ?? []) {
    const text = (entry.text ?? "").trim();
    if (!text) continue;
    const fromMs = entry.offsets?.from;
    const toMs = entry.offsets?.to;
    if (typeof fromMs !== "number" || typeof toMs !== "number") continue;
    segments.push({ start: fromMs / 1000, end: toMs / 1000, text });
  }
  return {
    language: raw.result?.language ?? null,
    segments,
  };
}

async function runWhisper(wavPath: string, outputBase: string): Promise<WhisperJsonOutput> {
  if (!WHISPER_MODEL_PATH || !existsSync(WHISPER_MODEL_PATH)) {
    throw new TranscribeError(
      `Whisper model not found at ${WHISPER_MODEL_PATH}. Run \`npm run setup:whisper\`.`,
    );
  }

  await run(WHISPER_CLI_PATH, [
    "-m",
    WHISPER_MODEL_PATH,
    "-f",
    wavPath,
    "-oj",
    "-of",
    outputBase,
    "-l",
    "auto",
    "--prompt",
    COOKING_VOCAB_PROMPT,
  ]);

  const jsonPath = `${outputBase}.json`;
  if (!existsSync(jsonPath)) {
    throw new TranscribeError(`whisper-cli did not produce ${jsonPath}`);
  }
  return JSON.parse(await readFile(jsonPath, "utf-8")) as WhisperJsonOutput;
}

/**
 * Transcribes a single audio file: ffmpeg -> 16kHz mono wav -> whisper-cli ->
 * normalised Transcript. `outputDir` is where the intermediate `audio.wav`
 * and `whisper.json` are written (it must already exist); this is the shared
 * core used by both `transcribeJob` (job storage) and the eval CLI (a case
 * folder under eval/cases/).
 */
export async function transcribeAudioFile(inputPath: string, outputDir: string): Promise<Transcript> {
  const wavPath = await convertToWav(inputPath, path.join(outputDir, "audio.wav"));
  const raw = await runWhisper(wavPath, path.join(outputDir, "whisper"));
  return parseWhisperJson(raw);
}

/**
 * Transcribes the job's uploaded audio: ffmpeg -> 16kHz mono wav -> whisper-cli
 * -> normalised Transcript, persisted to transcript.json. Throws a descriptive
 * error (e.g. missing whisper model) rather than a raw child_process failure.
 */
export async function transcribeJob(jobId: string): Promise<Transcript> {
  const original = await findOriginalAudio(jobId);
  if (!original) throw new TranscribeError(`No uploaded audio found for job ${jobId}`);
  // transcribeAudioFile's whisper-cli run already writes the raw output to
  // jobDir(jobId)/whisper.json (outputBase = jobDir/whisper), so there's
  // nothing further to persist here.
  const transcript = await transcribeAudioFile(original, jobDir(jobId));
  await saveTranscript(jobId, transcript);
  return transcript;
}
