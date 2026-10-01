import { describe, expect, it } from "vitest";
import { actualCostUsd, estimateInputTokens, estimateMaxCostUsd, priceFor } from "../src/cost";

describe("priceFor", () => {
  it("looks up a known model", () => {
    expect(priceFor("claude-haiku-4-5")).toEqual({ input: 1, output: 5 });
  });

  it("strips a dated suffix", () => {
    expect(priceFor("claude-haiku-4-5-20260115")).toEqual({ input: 1, output: 5 });
  });

  it("falls back to the most expensive known price for an unknown model", () => {
    const fallback = priceFor("some-future-model");
    const mostExpensive = Math.max(
      priceFor("claude-haiku-4-5").output,
      priceFor("claude-sonnet-5").output,
      priceFor("claude-opus-5").output,
      priceFor("claude-opus-5-5").output,
    );
    expect(fallback.output).toBe(mostExpensive);
  });
});

describe("estimateInputTokens", () => {
  it("uses a ~4 chars/token heuristic", () => {
    expect(estimateInputTokens(400)).toBe(100);
  });

  it("rounds up", () => {
    expect(estimateInputTokens(1)).toBe(1);
  });
});

describe("estimateMaxCostUsd", () => {
  it("prices the worst case: all max_tokens billed as output", () => {
    // haiku-4-5: input $1/M, output $5/M. 4000 chars -> 1000 input tokens.
    const cost = estimateMaxCostUsd("claude-haiku-4-5", 4000, 8000);
    const expected = (1000 * 1 + 8000 * 5) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("grows with max_tokens", () => {
    const small = estimateMaxCostUsd("claude-haiku-4-5", 4000, 1000);
    const large = estimateMaxCostUsd("claude-haiku-4-5", 4000, 8000);
    expect(large).toBeGreaterThan(small);
  });
});

describe("actualCostUsd", () => {
  it("matches a hand-computed total including cache discounts", () => {
    const usage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 100 };
    const cost = actualCostUsd("claude-haiku-4-5", usage);
    const expected = (1000 * 1 + 200 * 1 * 0.1 + 100 * 1 * 1.25 + 500 * 5) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("is zero for zero usage", () => {
    expect(
      actualCostUsd("claude-haiku-4-5", {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(0);
  });
});
