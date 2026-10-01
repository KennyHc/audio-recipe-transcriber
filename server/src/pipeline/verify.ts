import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  ensureAmountWarnings,
  formatVerifierUserMessage,
  type ExtractedRecipe,
  type RecipeWarning,
  type Transcript,
  VERIFIER_SYSTEM,
  VerifierOutput,
} from "@recipe/shared";
import { CLAUDE_BACKEND, VERIFIER_MODEL } from "../config.ts";
import { callClaudeCli } from "../llm/claudeCli.ts";
import { recordUsage } from "../llm/usage.ts";

// Created lazily: in "cli" mode there may be no API key at all.
let client: Anthropic | undefined;

export class VerificationError extends Error {}

/**
 * Runs the verifier agent against a transcript + extracted recipe and
 * returns its warnings. Unlike extraction, a verification failure must NOT
 * fail the job — callers should catch VerificationError and fall back to a
 * single "other" warning saying verification could not run (see run.ts).
 */
export async function verifyRecipe(
  transcript: Transcript,
  recipe: ExtractedRecipe,
): Promise<RecipeWarning[]> {
  return ensureAmountWarnings(recipe, await callVerifier(transcript, recipe));
}

export { ensureAmountWarnings };

async function callVerifier(
  transcript: Transcript,
  recipe: ExtractedRecipe,
): Promise<RecipeWarning[]> {
  // Haiku 4.5 does not support adaptive thinking, so no `thinking` param and
  // no `effort` here (unlike the extractor).
  if (CLAUDE_BACKEND === "cli") {
    try {
      const out = await callClaudeCli({ model: VERIFIER_MODEL, system: VERIFIER_SYSTEM, user: formatVerifierUserMessage(transcript, recipe), schema: VerifierOutput });
      return out.warnings;
    } catch (e) {
      throw new VerificationError(e instanceof Error ? e.message : String(e));
    }
  }

  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  const response = await client.messages.parse({
    model: VERIFIER_MODEL,
    max_tokens: 8000,
    output_config: { format: zodOutputFormat(VerifierOutput) },
    system: VERIFIER_SYSTEM,
    messages: [{ role: "user", content: formatVerifierUserMessage(transcript, recipe) }],
  });
  recordUsage({
    stage: "verify",
    model: VERIFIER_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  });


  if (response.stop_reason === "refusal") {
    throw new VerificationError("The verifier model refused to process this recipe.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new VerificationError("The verifier model ran out of output tokens before finishing.");
  }
  if (response.parsed_output == null) {
    throw new VerificationError("The verifier model did not return a parseable result.");
  }

  return response.parsed_output.warnings;
}
