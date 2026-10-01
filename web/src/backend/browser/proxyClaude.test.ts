import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedRecipe, Transcript } from "@recipe/shared";
import { TURNSTILE_HEADER } from "@recipe/shared";
import type { BrowserSettings } from "../types";

const mockGetTurnstileToken = vi.hoisted(() => vi.fn());
vi.mock("@/lib/turnstile", () => ({ getTurnstileToken: mockGetTurnstileToken }));

import { ExtractionError, VerificationError, describeProxyError, extractRecipe, verifyRecipe } from "./proxyClaude";

const transcript: Transcript = {
  language: "en",
  segments: [{ start: 0, end: 4, text: "Two cups of flour" }],
};

const recipe: ExtractedRecipe = {
  title: "Flour Mix",
  description: null,
  servings: null,
  totalTimeMinutes: null,
  ingredients: [
    {
      quantity: 2,
      unit: "cup",
      item: "flour",
      prep: null,
      sourceText: "Two cups of flour",
      timestamp: 0,
      confidence: "stated",
    },
  ],
  steps: [{ text: "Mix the flour.", timestamp: 0, durationMinutes: null, temperature: null }],
  tips: [],
};

const settings = {} as BrowserSettings;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("proxyClaude", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:8788");
    mockGetTurnstileToken.mockReset();
    mockGetTurnstileToken.mockResolvedValue("fresh-token");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("extractRecipe", () => {
    it("rejects immediately on an empty transcript without calling the proxy", async () => {
      await expect(extractRecipe({ language: "en", segments: [] }, settings)).rejects.toBeInstanceOf(ExtractionError);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("POSTs to /extract with a fresh Turnstile token and parses the response", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { recipe }));

      const result = await extractRecipe(transcript, settings);

      expect(result).toEqual(recipe);
      expect(mockGetTurnstileToken).toHaveBeenCalledTimes(1);
      const [url, init] = vi.mocked(fetch).mock.calls[0]!;
      expect(url).toBe("http://localhost:8788/extract");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)[TURNSTILE_HEADER]).toBe("fresh-token");
      expect(JSON.parse(init?.body as string)).toEqual({ transcript });
    });

    it("throws ExtractionError with a schema-validation-failure message on a malformed response", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { recipe: { not: "a recipe" } }));
      await expect(extractRecipe(transcript, settings)).rejects.toThrow(ExtractionError);
    });

    it("wraps a Turnstile failure in ExtractionError without calling fetch", async () => {
      mockGetTurnstileToken.mockRejectedValue(new Error("Timed out verifying this browser — please reload the page and try again."));
      await expect(extractRecipe(transcript, settings)).rejects.toThrow(/Timed out verifying this browser/);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("wraps a network failure (fetch throws) in a friendly message", async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
      await expect(extractRecipe(transcript, settings)).rejects.toThrow(/Couldn't reach the recipe service/);
    });
  });

  describe("verifyRecipe", () => {
    it("POSTs to /verify with transcript + recipe and returns warnings", async () => {
      const warnings = [{ kind: "other" as const, message: "check salt", target: null, suggestion: null }];
      vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { warnings }));

      const result = await verifyRecipe(transcript, recipe, settings);

      expect(result).toEqual(warnings);
      const [url, init] = vi.mocked(fetch).mock.calls[0]!;
      expect(url).toBe("http://localhost:8788/verify");
      expect(JSON.parse(init?.body as string)).toEqual({ transcript, recipe });
    });

    it("throws VerificationError on a non-2xx ProxyError body", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse(429, { error: "rate limited", code: "rate_limited", retryAfterSeconds: 7200 }),
      );
      await expect(verifyRecipe(transcript, recipe, settings)).rejects.toThrow(VerificationError);
    });
  });

  describe("error code -> message mapping (describeProxyError)", () => {
    it("rate_limited includes the reset window in hours", () => {
      expect(describeProxyError({ error: "x", code: "rate_limited", retryAfterSeconds: 7200 })).toMatch(
        /reached today's free limit \(20 recipes\)\. It resets in about 2 hours\./,
      );
    });

    it("rate_limited with no retryAfterSeconds still gives a sensible message", () => {
      expect(describeProxyError({ error: "x", code: "rate_limited", retryAfterSeconds: null })).toMatch(
        /reached today's free limit/,
      );
    });

    it("budget_exhausted", () => {
      expect(describeProxyError({ error: "x", code: "budget_exhausted", retryAfterSeconds: null })).toBe(
        "The free service has reached its daily limit for everyone. Please try again tomorrow.",
      );
    });

    it("bot_check_failed", () => {
      expect(describeProxyError({ error: "x", code: "bot_check_failed", retryAfterSeconds: null })).toBe(
        "Couldn't verify this browser — please reload the page and try again.",
      );
    });

    it("too_large", () => {
      expect(describeProxyError({ error: "x", code: "too_large", retryAfterSeconds: null })).toBe(
        "This recording is too long for the free service (about 30 minutes max).",
      );
    });

    it("upstream_error and bad_request fall back to the generic retry message", () => {
      expect(describeProxyError({ error: "x", code: "upstream_error", retryAfterSeconds: null })).toBe(
        "The recipe service had a problem — please press Retry.",
      );
      expect(describeProxyError({ error: "x", code: "bad_request", retryAfterSeconds: null })).toBe(
        "The recipe service had a problem — please press Retry.",
      );
    });
  });
});
