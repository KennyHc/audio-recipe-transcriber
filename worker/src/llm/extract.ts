import { EXTRACTOR_SYSTEM, ExtractedRecipe, formatTranscriptForPrompt, type Transcript } from "@recipe/shared";
import { callStructuredOutput, type ClaudeUsage } from "./claudeClient";

export const EXTRACT_MAX_TOKENS = 8000;

export async function extractRecipe(
  apiKey: string,
  model: string,
  transcript: Transcript,
): Promise<{ recipe: ExtractedRecipe; usage: ClaudeUsage }> {
  const { output, usage } = await callStructuredOutput({
    apiKey,
    model,
    system: EXTRACTOR_SYSTEM,
    user: formatTranscriptForPrompt(transcript),
    schema: ExtractedRecipe,
    maxTokens: EXTRACT_MAX_TOKENS,
  });
  return { recipe: output, usage };
}
