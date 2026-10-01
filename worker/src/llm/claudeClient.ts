import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { appError } from "../errors";

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface StructuredCallParams<T> {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
}

export interface StructuredCallResult<T> {
  output: T;
  usage: ClaudeUsage;
}

/**
 * Runs a single structured-output Claude call and maps every failure mode
 * (refusal, truncation, unparseable output) to the generic `upstream_error`
 * the client sees — never the SDK's own message, which could in principle
 * echo request details.
 *
 * Haiku 4.5 predates adaptive thinking/effort; sending either is a 400 (see
 * server/src/pipeline/extract.ts for the equivalent non-Worker logic).
 */
export async function callStructuredOutput<T>(params: StructuredCallParams<T>): Promise<StructuredCallResult<T>> {
  const client = new Anthropic({ apiKey: params.apiKey });
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

  if (response.stop_reason === "refusal") throw appError("upstream_error");
  if (response.stop_reason === "max_tokens") throw appError("upstream_error");
  if (response.parsed_output == null) throw appError("upstream_error");

  return { output: response.parsed_output, usage };
}
