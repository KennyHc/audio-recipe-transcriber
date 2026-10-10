import type { ExtractedRecipe, PublishAssistOutput, RecipeWarning, ScreeningOutput, Transcript } from "@recipe/shared";
import type { ClaudeUsage } from "../cost";
import { AppError } from "../errors";

export interface ClaudeResult<T> {
  output: T;
  usage: ClaudeUsage;
}

/**
 * The Claude calls the API makes. Implementations return the model's RAW output; the
 * deterministic post-processing (normalizeExtractedRecipe, finalizeWarnings) happens in
 * pipeline.ts so it runs — and is tested — no matter which implementation is plugged in.
 * Tests pass a fake; src/claude/anthropic.ts is the real one.
 */
export interface ClaudeService {
  extract(transcript: Transcript): Promise<ClaudeResult<ExtractedRecipe>>;
  verify(transcript: Transcript, recipe: ExtractedRecipe): Promise<ClaudeResult<RecipeWarning[]>>;
  /** Publish screening (Phase 2). `userMessage` is formatScreeningInput(...) — untrusted text. */
  screen(userMessage: string): Promise<ClaudeResult<ScreeningOutput>>;
  /** Publish-dialog suggestions. `userMessage` is formatPublishAssistInput(...) — untrusted text. */
  suggest(userMessage: string): Promise<ClaudeResult<PublishAssistOutput>>;
}

/** max_tokens for each call; also the worst-case output used to reserve budget. */
export const EXTRACT_MAX_TOKENS = 8000;
export const VERIFY_MAX_TOKENS = 8000;
/** The screening answer is one enum + one sentence. */
export const SCREEN_MAX_TOKENS = 300;
/** A few tag ids + one sentence. */
export const SUGGEST_MAX_TOKENS = 300;

/**
 * A response came back but was unusable (refusal, truncated, unparseable). Unlike a network
 * or API error, those tokens were billed, so the budget settles with `usage` instead of
 * releasing the reservation.
 */
export class ClaudeOutputError extends AppError {
  readonly usage: ClaudeUsage;
  constructor(usage: ClaudeUsage) {
    super("upstream_error");
    this.usage = usage;
  }
}
