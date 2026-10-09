/**
 * Cost estimation/accounting for the daily budget. Ported from worker/src/cost.ts, which
 * mirrors the price table in server/src/llm/usage.ts (USD per million tokens, Claude API
 * list prices) — keep all three in sync if prices change.
 */

export interface ModelPrice {
  input: number;
  output: number;
}

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

/** Conservative fallback for a model not in PRICES, so an unreserved call can't slip past the budget. */
const MOST_EXPENSIVE_KNOWN_PRICE: ModelPrice = Object.values(PRICES).reduce((max, p) =>
  p.output > max.output ? p : max,
);

export function priceFor(model: string): ModelPrice {
  return PRICES[model.replace(/-\d{8}$/, "")] ?? MOST_EXPENSIVE_KNOWN_PRICE;
}

/** Rough chars-per-token heuristic for estimating cost before a call is made. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

export function estimateInputTokens(inputChars: number): number {
  return Math.ceil(inputChars / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Worst-case cost of a call: all of max_tokens billed as output, no cache discount on
 * input. Used to reserve budget before the call is made.
 */
export function estimateMaxCostUsd(model: string, inputChars: number, maxTokens: number): number {
  const price = priceFor(model);
  const inputTokens = estimateInputTokens(inputChars);
  return (inputTokens * price.input + maxTokens * price.output) / 1_000_000;
}

/** Actual cost of a completed call, from the SDK's reported usage. */
export function actualCostUsd(model: string, usage: ClaudeUsage): number {
  const price = priceFor(model);
  return (
    (usage.inputTokens * price.input +
      usage.cacheReadTokens * price.input * 0.1 +
      usage.cacheWriteTokens * price.input * 1.25 +
      usage.outputTokens * price.output) /
    1_000_000
  );
}
