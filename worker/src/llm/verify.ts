import {
  type ExtractedRecipe,
  ensureAmountWarnings,
  formatVerifierUserMessage,
  type RecipeWarning,
  type Transcript,
  VERIFIER_SYSTEM,
  VerifierOutput,
} from "@recipe/shared";
import { callStructuredOutput, type ClaudeUsage } from "./claudeClient";

export const VERIFY_MAX_TOKENS = 8000;

export async function verifyRecipe(
  apiKey: string,
  model: string,
  transcript: Transcript,
  recipe: ExtractedRecipe,
): Promise<{ warnings: RecipeWarning[]; usage: ClaudeUsage }> {
  const { output, usage } = await callStructuredOutput({
    apiKey,
    model,
    system: VERIFIER_SYSTEM,
    user: formatVerifierUserMessage(transcript, recipe),
    schema: VerifierOutput,
    maxTokens: VERIFY_MAX_TOKENS,
  });
  return { warnings: ensureAmountWarnings(recipe, output.warnings), usage };
}
