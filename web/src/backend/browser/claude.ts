// Extract + verify, calling Claude directly from the browser with the user's
// own API key. Mirrors server/src/pipeline/extract.ts and verify.ts (the "api"
// backend path — the browser has no CLI to shell out to), but there's no
// server-side env var: the model choice and API key both come from
// BrowserSettings (localStorage), never hardcoded.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  EXTRACTOR_SYSTEM,
  ExtractedRecipe,
  finalizeWarnings,
  normalizeExtractedRecipe,
  formatTranscriptForPrompt,
  formatVerifierUserMessage,
  VERIFIER_SYSTEM,
  VerifierOutput,
  type ExtractedRecipe as ExtractedRecipeType,
  type RecipeWarning,
  type Transcript,
} from "@recipe/shared";
import { NeedsSetupError, type BrowserSettings } from "../types";

export class ExtractionError extends Error {}
export class VerificationError extends Error {}

function requireApiKey(settings: BrowserSettings): string {
  if (!settings.apiKey) {
    throw new NeedsSetupError("No Claude API key configured. Add one in Settings.");
  }
  return settings.apiKey;
}

function makeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/** Maps SDK errors to a short, human-readable message the UI can show as-is. */
function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Your API key was rejected — check it in Settings.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "Your API key does not have permission to use this model.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Claude's API rate limit was hit — wait a moment and try again.";
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return "Timed out connecting to Claude's API — check your network connection and try again.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Could not connect to Claude's API — check your network connection.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `Claude's API rejected the request: ${err.message}`;
  }
  if (err instanceof Anthropic.InternalServerError) {
    return "Claude's API had an internal error — try again shortly.";
  }
  if (err instanceof Anthropic.APIError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs the extractor agent on a transcript and returns a structured
 * ExtractedRecipe. Throws NeedsSetupError if no API key is configured, or
 * ExtractionError with a human-readable message on refusal, truncation, or a
 * missing/invalid parsed result — extraction failure fails the whole job
 * (unlike verification).
 */
export async function extractRecipe(transcript: Transcript, settings: BrowserSettings): Promise<ExtractedRecipeType> {
  if (transcript.segments.length === 0) {
    throw new ExtractionError("Transcript has no segments — nothing to extract a recipe from.");
  }

  const apiKey = requireApiKey(settings);
  const client = makeClient(apiKey);
  const model = settings.extractorModel;
  // Haiku 4.5 predates adaptive thinking and effort; sending either is a 400 (mirrors server extract.ts).
  const isHaiku45 = model.startsWith("claude-haiku-4-5");

  let response;
  try {
    response = await client.messages.parse({
      model,
      max_tokens: 16000,
      ...(isHaiku45
        ? { output_config: { format: zodOutputFormat(ExtractedRecipe) } }
        : {
            thinking: { type: "adaptive" as const },
            output_config: { effort: "medium" as const, format: zodOutputFormat(ExtractedRecipe) },
          }),
      system: EXTRACTOR_SYSTEM,
      messages: [{ role: "user", content: formatTranscriptForPrompt(transcript) }],
    });
  } catch (err) {
    throw new ExtractionError(describeApiError(err));
  }

  if (response.stop_reason === "refusal") {
    throw new ExtractionError("The extractor model refused to process this transcript.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new ExtractionError("The extractor model ran out of output tokens before finishing.");
  }
  if (response.parsed_output == null) {
    throw new ExtractionError("The extractor model did not return a parseable recipe.");
  }

  return normalizeExtractedRecipe(response.parsed_output);
}

/**
 * Runs the verifier agent against a transcript + extracted recipe and
 * returns its warnings (with finalizeWarnings applied). Throws
 * NeedsSetupError if no API key is configured, or VerificationError on
 * failure — callers should catch VerificationError and fall back to a single
 * "other" warning (see runner.ts), matching server/src/pipeline/run.ts.
 */
export async function verifyRecipe(
  transcript: Transcript,
  recipe: ExtractedRecipeType,
  settings: BrowserSettings,
): Promise<RecipeWarning[]> {
  const apiKey = requireApiKey(settings);
  const client = makeClient(apiKey);
  const model = settings.verifierModel;

  let response;
  try {
    // Haiku 4.5 does not support adaptive thinking, so no `thinking`/`effort` here (unlike the extractor).
    response = await client.messages.parse({
      model,
      max_tokens: 8000,
      output_config: { format: zodOutputFormat(VerifierOutput) },
      system: VERIFIER_SYSTEM,
      messages: [{ role: "user", content: formatVerifierUserMessage(transcript, recipe) }],
    });
  } catch (err) {
    throw new VerificationError(describeApiError(err));
  }

  if (response.stop_reason === "refusal") {
    throw new VerificationError("The verifier model refused to process this recipe.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new VerificationError("The verifier model ran out of output tokens before finishing.");
  }
  if (response.parsed_output == null) {
    throw new VerificationError("The verifier model did not return a parseable result.");
  }

  return finalizeWarnings(recipe, response.parsed_output.warnings);
}
