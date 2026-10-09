import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  EXTRACTOR_SYSTEM,
  ExtractedRecipe,
  formatTranscriptForPrompt,
  formatVerifierUserMessage,
  VERIFIER_SYSTEM,
  VerifierOutput,
} from "@recipe/shared";
import type { z } from "zod";
import type { ClaudeUsage } from "../cost";
import { ClaudeOutputError, type ClaudeResult, type ClaudeService, EXTRACT_MAX_TOKENS, VERIFY_MAX_TOKENS } from "./types";

export interface AnthropicClaudeOptions {
  apiKey: string;
  extractorModel: string;
  verifierModel: string;
}

/** The real ClaudeService: official SDK, shared prompts, structured outputs (ported from worker/src/llm). */
export function createAnthropicClaude(options: AnthropicClaudeOptions): ClaudeService {
  // One client per process. Two calls must fit in Cloud Run's 120 s request timeout
  // (scripts/deploy-api.sh), so: one attempt each, 55 s max. A failed extract refunds the
  // user's quota, so retrying is cheap for them.
  const client = new Anthropic({ apiKey: options.apiKey, timeout: 55_000, maxRetries: 0 });

  return {
    extract: (transcript) =>
      callStructuredOutput(client, {
        model: options.extractorModel,
        system: EXTRACTOR_SYSTEM,
        user: formatTranscriptForPrompt(transcript),
        schema: ExtractedRecipe,
        maxTokens: EXTRACT_MAX_TOKENS,
      }),
    verify: async (transcript, recipe) => {
      const { output, usage } = await callStructuredOutput(client, {
        model: options.verifierModel,
        system: VERIFIER_SYSTEM,
        user: formatVerifierUserMessage(transcript, recipe),
        schema: VerifierOutput,
        maxTokens: VERIFY_MAX_TOKENS,
      });
      return { output: output.warnings, usage };
    },
  };
}

interface StructuredCallParams<T> {
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
}

/**
 * One structured-output call. Unusable responses (refusal, truncation, null parse) throw
 * ClaudeOutputError (a generic upstream_error carrying the billed usage); SDK errors
 * propagate and pipeline.ts maps them to upstream_error too — their text is never shown to
 * the client.
 *
 * Haiku 4.5 predates adaptive thinking/effort; sending either is a 400 (same switch as
 * worker/src/llm/claudeClient.ts and server/src/pipeline/extract.ts).
 */
async function callStructuredOutput<T>(client: Anthropic, params: StructuredCallParams<T>): Promise<ClaudeResult<T>> {
  const isHaiku45 = params.model.startsWith("claude-haiku-4-5");

  const response = await client.messages.parse({
    model: params.model,
    max_tokens: params.maxTokens,
    ...(isHaiku45
      ? { output_config: { format: zodOutputFormat(params.schema) } }
      : {
          thinking: { type: "adaptive" as const },
          output_config: { effort: "medium" as const, format: zodOutputFormat(params.schema) },
        }),
    system: params.system,
    messages: [{ role: "user", content: params.user }],
  });

  const usage: ClaudeUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  };

  if (response.stop_reason === "refusal") throw new ClaudeOutputError(usage);
  if (response.stop_reason === "max_tokens") throw new ClaudeOutputError(usage);
  if (response.parsed_output == null) throw new ClaudeOutputError(usage);

  return { output: response.parsed_output, usage };
}
