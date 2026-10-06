import { z } from "zod";
import { ExtractedRecipe, RecipeWarning, Transcript } from "./recipe";

// Contract between the hosted web app ("hosted" mode) and the Cloudflare Worker in
// worker/. The Worker holds the operator's Anthropic key as a Cloudflare secret and
// exposes ONLY these two narrow endpoints: it builds the Claude request itself from the
// shared prompts with a fixed model and limits, so the key can't be used for anything
// but recipe extraction. The key never reaches the browser.
//
//   POST {API_BASE}/extract   body ExtractRequest  -> ExtractResponse
//   POST {API_BASE}/verify    body VerifyRequest   -> VerifyResponse
//   GET  {API_BASE}/quota                          -> QuotaResponse
//        Read-only: today's per-visitor allowance. No Turnstile token needed (it never
//        calls Claude and doesn't change any counter).
//
// Every request must carry a fresh Cloudflare Turnstile token in the
// `X-Turnstile-Token` header (tokens are single-use; get a new one per request).
// Errors: non-2xx with body ProxyError.

export const TURNSTILE_HEADER = "X-Turnstile-Token";

/** Longest transcript accepted (~30+ minutes of speech). */
export const MAX_TRANSCRIPT_CHARS = 40_000;

export const ExtractRequest = z.object({ transcript: Transcript });
export type ExtractRequest = z.infer<typeof ExtractRequest>;

export const ExtractResponse = z.object({ recipe: ExtractedRecipe });
export type ExtractResponse = z.infer<typeof ExtractResponse>;

export const VerifyRequest = z.object({ transcript: Transcript, recipe: ExtractedRecipe });
export type VerifyRequest = z.infer<typeof VerifyRequest>;

/** Already includes ensureAmountWarnings. */
export const VerifyResponse = z.object({ warnings: z.array(RecipeWarning) });
export type VerifyResponse = z.infer<typeof VerifyResponse>;

export const ProxyErrorCode = z.enum([
  "bad_request", // 400: body failed validation
  "too_large", // 413: transcript over MAX_TRANSCRIPT_CHARS
  "bot_check_failed", // 403: missing/invalid Turnstile token
  "rate_limited", // 429: this visitor used today's allowance
  "budget_exhausted", // 503: the app's daily spend cap is reached for everyone
  "upstream_error", // 502: Claude call failed (refusal, max_tokens, API error)
]);
export type ProxyErrorCode = z.infer<typeof ProxyErrorCode>;

export const ProxyError = z.object({
  error: z.string(), // human-readable, safe to show the user
  code: ProxyErrorCode,
  retryAfterSeconds: z.number().nullable(), // e.g. seconds until the next UTC day
});
export type ProxyError = z.infer<typeof ProxyError>;

export const QuotaResponse = z.object({
  limit: z.number(), // recipes per visitor per UTC day
  remaining: z.number(), // never negative
  resetsInSeconds: z.number(), // until next UTC midnight
});
export type QuotaResponse = z.infer<typeof QuotaResponse>;
