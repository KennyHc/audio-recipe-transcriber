import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type ExtractedRecipe, type RecipeWarning, type Transcript, VerifierOutput } from "@recipe/shared";
import { CLAUDE_BACKEND, VERIFIER_MODEL } from "../config.ts";
import { callClaudeCli } from "../llm/claudeCli.ts";
import { formatVerifierUserMessage, VERIFIER_SYSTEM } from "../prompts/verifier.ts";

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

/**
 * Every vague/inferred ingredient without an amount must be flagged. The verifier
 * usually does this, but not reliably run to run, so it's guaranteed in code; the
 * model's own warnings (which carry a suggested amount) take precedence.
 */
export function ensureAmountWarnings(
  recipe: ExtractedRecipe,
  warnings: RecipeWarning[],
): RecipeWarning[] {
  const added: RecipeWarning[] = [];
  recipe.ingredients.forEach((ing, i) => {
    if (ing.quantity !== null || ing.confidence === "stated") return;
    const target = `ingredients[${i}]`;
    if (warnings.some((w) => w.target === target)) return;
    added.push({
      kind: ing.confidence === "inferred" ? "missing_ingredient" : "vague_quantity",
      message:
        ing.confidence === "inferred"
          ? `No amount was given for ${ing.item}; it's only implied by the method.`
          : `The amount of ${ing.item} is imprecise ("${ing.sourceText}").`,
      target,
      suggestion: null,
    });
  });
  return [...warnings, ...added];
}

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
