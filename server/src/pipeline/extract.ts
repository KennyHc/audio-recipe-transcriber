import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ExtractedRecipe, type Transcript } from "@recipe/shared";
import { CLAUDE_BACKEND, EXTRACTOR_EFFORT, EXTRACTOR_MODEL } from "../config.ts";
import { callClaudeCli } from "../llm/claudeCli.ts";
import { recordUsage } from "../llm/usage.ts";
import { EXTRACTOR_SYSTEM, formatTranscriptForPrompt } from "@recipe/shared";

// Created lazily: in "cli" mode there may be no API key at all.
let client: Anthropic | undefined;

export class ExtractionError extends Error {}

/**
 * Runs the extractor agent on a transcript and returns a structured
 * ExtractedRecipe. Throws ExtractionError with a human-readable message on
 * refusal, truncation, or a missing/invalid parsed result — extraction
 * failure fails the whole job (unlike verification).
 */
export async function extractRecipe(transcript: Transcript): Promise<ExtractedRecipe> {
  if (transcript.segments.length === 0) {
    throw new ExtractionError("Transcript has no segments — nothing to extract a recipe from.");
  }

  if (CLAUDE_BACKEND === "cli") {
    try {
      const out = await callClaudeCli({ model: EXTRACTOR_MODEL, system: EXTRACTOR_SYSTEM, user: formatTranscriptForPrompt(transcript), schema: ExtractedRecipe });
      return out;
    } catch (e) {
      throw new ExtractionError(e instanceof Error ? e.message : String(e));
    }
  }

  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  const isHaiku45 = EXTRACTOR_MODEL.startsWith("claude-haiku-4-5");
  const response = await client.messages.parse({
    model: EXTRACTOR_MODEL,
    max_tokens: 16000,
    // Haiku 4.5 predates adaptive thinking and effort; sending either is a 400.
    ...(isHaiku45
      ? { output_config: { format: zodOutputFormat(ExtractedRecipe) } }
      : {
          thinking: { type: "adaptive" as const },
          output_config: { effort: EXTRACTOR_EFFORT, format: zodOutputFormat(ExtractedRecipe) },
        }),
    system: EXTRACTOR_SYSTEM,
    messages: [{ role: "user", content: formatTranscriptForPrompt(transcript) }],
  });
  recordUsage({
    stage: "extract",
    model: EXTRACTOR_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  });


  if (response.stop_reason === "refusal") {
    throw new ExtractionError("The extractor model refused to process this transcript.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new ExtractionError("The extractor model ran out of output tokens before finishing.");
  }

  if (response.parsed_output == null) {
    throw new ExtractionError("The extractor model did not return a parseable recipe.");
  }

  return response.parsed_output;
}
