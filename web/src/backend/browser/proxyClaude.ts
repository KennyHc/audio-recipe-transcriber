// Extract + verify for the hosted build: calls Claude indirectly through the operator's
// Cloudflare Worker (see shared/proxy.ts for the full contract) instead of the Anthropic API
// directly. No Anthropic key, and no @anthropic-ai/sdk import, anywhere in this module — the
// Worker holds the key and makes the actual Claude call; this module only POSTs typed
// requests and parses typed responses, gated by a fresh Cloudflare Turnstile token per call.
//
// Mirrors claude.ts's extractRecipe/verifyRecipe signatures (and its ExtractionError/
// VerificationError classes) so runner.ts can use either implementation interchangeably via
// claudeProvider.ts — see that module for how the build-time swap works and why it keeps the
// Anthropic SDK out of this bundle entirely.

import {
  ExtractRequest,
  ExtractResponse,
  ProxyError,
  TURNSTILE_HEADER,
  VerifyRequest,
  VerifyResponse,
  type ProxyError as ProxyErrorType,
} from "@recipe/shared";
import type { ExtractedRecipe as ExtractedRecipeType, RecipeWarning, Transcript } from "@recipe/shared";
import { getTurnstileToken } from "@/lib/turnstile";
import type { BrowserSettings } from "../types";

export class ExtractionError extends Error {}
export class VerificationError extends Error {}

const NETWORK_FAILURE_MESSAGE = "Couldn't reach the recipe service — check your connection and press Retry.";
const GENERIC_UPSTREAM_MESSAGE = "The recipe service had a problem — please press Retry.";
const BOT_CHECK_MESSAGE = "Couldn't verify this browser — please reload the page and try again.";

function apiBase(): string {
  const base = import.meta.env.VITE_API_BASE;
  if (!base) {
    throw new Error("This hosted build is missing VITE_API_BASE — the recipe service is not configured.");
  }
  return base.replace(/\/+$/, "");
}

/** Maps a ProxyError's code (see shared/proxy.ts) to a short, human-readable message. */
export function describeProxyError(err: ProxyErrorType): string {
  switch (err.code) {
    case "rate_limited": {
      if (err.retryAfterSeconds != null && err.retryAfterSeconds > 0) {
        const hours = Math.max(1, Math.round(err.retryAfterSeconds / 3600));
        return `You've reached today's free limit (20 recipes). It resets in about ${hours} hour${hours === 1 ? "" : "s"}.`;
      }
      return "You've reached today's free limit (20 recipes). It resets in about a day.";
    }
    case "budget_exhausted":
      return "The free service has reached its daily limit for everyone. Please try again tomorrow.";
    case "bot_check_failed":
      return BOT_CHECK_MESSAGE;
    case "too_large":
      return "This recording is too long for the free service (about 30 minutes max).";
    case "bad_request":
    case "upstream_error":
    default:
      return GENERIC_UPSTREAM_MESSAGE;
  }
}

/**
 * POSTs a Turnstile-gated request to one of the Worker's two endpoints and returns the parsed
 * response. Throws a plain Error with an already-friendly, show-as-is message on any failure
 * (bad Turnstile token/timeout, network failure, non-2xx ProxyError, or a response that fails
 * schema validation) — callers wrap it in ExtractionError/VerificationError.
 */
async function callProxy<Res>(
  path: "/extract" | "/verify",
  body: unknown,
  responseSchema: { parse: (v: unknown) => Res },
): Promise<Res> {
  let token: string;
  try {
    token = await getTurnstileToken();
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : BOT_CHECK_MESSAGE);
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [TURNSTILE_HEADER]: token },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(NETWORK_FAILURE_MESSAGE);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const parsedError = ProxyError.safeParse(payload);
    throw new Error(parsedError.success ? describeProxyError(parsedError.data) : GENERIC_UPSTREAM_MESSAGE);
  }

  try {
    return responseSchema.parse(payload);
  } catch {
    throw new Error(GENERIC_UPSTREAM_MESSAGE);
  }
}

/**
 * Runs extraction via the Worker's /extract endpoint. Throws ExtractionError with a
 * human-readable message — matches claude.ts's extractRecipe contract (runner.ts treats
 * extraction failure the same way regardless of which module produced it).
 */
export async function extractRecipe(transcript: Transcript, _settings: BrowserSettings): Promise<ExtractedRecipeType> {
  if (transcript.segments.length === 0) {
    throw new ExtractionError("Transcript has no segments — nothing to extract a recipe from.");
  }

  const body: ExtractRequest = { transcript };
  try {
    const { recipe } = await callProxy("/extract", body, ExtractResponse);
    return recipe;
  } catch (err) {
    throw new ExtractionError(err instanceof Error ? err.message : GENERIC_UPSTREAM_MESSAGE);
  }
}

/**
 * Runs verification via the Worker's /verify endpoint. Throws VerificationError on failure —
 * callers (runner.ts) catch it and fall back to a single "other" warning, same as claude.ts.
 */
export async function verifyRecipe(
  transcript: Transcript,
  recipe: ExtractedRecipeType,
  _settings: BrowserSettings,
): Promise<RecipeWarning[]> {
  const body: VerifyRequest = { transcript, recipe };
  try {
    const { warnings } = await callProxy("/verify", body, VerifyResponse);
    return warnings;
  } catch (err) {
    throw new VerificationError(err instanceof Error ? err.message : GENERIC_UPSTREAM_MESSAGE);
  }
}
