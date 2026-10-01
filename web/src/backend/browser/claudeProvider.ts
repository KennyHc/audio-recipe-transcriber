// Picks the Claude implementation the job runner (./runner.ts) calls through, based on the
// build-time backend mode:
//   "browser" (BYOK)  — calls Claude directly with the visitor's own API key (./claude.ts).
//   "hosted"           — calls the operator's Cloudflare Worker via a Turnstile-gated proxy
//                         request (./proxyClaude.ts); no Anthropic key ever reaches the browser.
//
// Resolved with a statically-known `import.meta.env.VITE_BACKEND` branch, mirroring
// backend/index.ts's resolveBackend — Vite/esbuild's dead-code elimination drops the unreached
// `import()` entirely, so a hosted build never pulls in @anthropic-ai/sdk (which only ./claude.ts
// imports) into its module graph. runner.ts imports exclusively from this module, never from
// ./claude.ts or ./proxyClaude.ts directly, so the two stay swappable without touching runner.ts.

import type { ExtractedRecipe, RecipeWarning, Transcript } from "@recipe/shared";
import type { BrowserSettings } from "../types";

type ExtractFn = (transcript: Transcript, settings: BrowserSettings) => Promise<ExtractedRecipe>;
type VerifyFn = (
  transcript: Transcript,
  recipe: ExtractedRecipe,
  settings: BrowserSettings,
) => Promise<RecipeWarning[]>;

interface ClaudeModule {
  extractRecipe: ExtractFn;
  verifyRecipe: VerifyFn;
  ExtractionError: new (message?: string) => Error;
  VerificationError: new (message?: string) => Error;
}

async function resolveClaudeModule(): Promise<ClaudeModule> {
  if (import.meta.env.VITE_BACKEND === "hosted") {
    return import("./proxyClaude");
  }
  return import("./claude");
}

const claudeModule = await resolveClaudeModule();

export const extractRecipe: ExtractFn = claudeModule.extractRecipe;
export const verifyRecipe: VerifyFn = claudeModule.verifyRecipe;
export const ExtractionError = claudeModule.ExtractionError;
export const VerificationError = claudeModule.VerificationError;
