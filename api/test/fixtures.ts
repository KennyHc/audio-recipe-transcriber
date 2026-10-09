import type { ExtractedRecipe, RecipeWarning, Transcript } from "@recipe/shared";
import type { ClaudeResult, ClaudeService } from "../src/claude/types";
import type { Config } from "../src/config";
import type { ClaudeUsage } from "../src/cost";

export const TRANSCRIPT: Transcript = {
  language: "en",
  segments: [
    { start: 0, end: 4, text: "Today we're making egg fried rice." },
    { start: 4, end: 9, text: "Beat two eggs, then fry them in some oil." },
    { start: 9, end: 14, text: "Add the cold rice and soy sauce and stir fry." },
  ],
};

/** Raw extractor output. "rice" has no amount → finalizeWarnings must add a warning for it. */
export const EXTRACTED: ExtractedRecipe = {
  title: "Egg Fried Rice",
  description: null,
  servings: null,
  totalTimeMinutes: null,
  ingredients: [
    { quantity: 2, unit: null, item: "eggs", prep: "beaten", sourceText: "two eggs", timestamp: 4, confidence: "stated" },
    { quantity: null, unit: null, item: "rice", prep: "cold", sourceText: "the cold rice", timestamp: 9, confidence: "stated" },
  ],
  steps: [
    { text: "Beat the eggs and fry them in oil.", timestamp: 4, durationMinutes: null, temperature: null },
    { text: "Add the rice and soy sauce and stir fry.", timestamp: 9, durationMinutes: null, temperature: null },
  ],
  tips: [],
};

export const VERIFIER_WARNINGS: RecipeWarning[] = [
  { kind: "missing_ingredient", message: "Oil is used but not listed.", target: "steps[0]", suggestion: null },
];

export const USAGE: ClaudeUsage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Fake Claude: records calls; behaviour per call is swappable. */
export class FakeClaude implements ClaudeService {
  extractCalls = 0;
  verifyCalls = 0;
  /** Transcripts passed to extract(), in call order. */
  extractedFrom: Transcript[] = [];
  onExtract: () => Promise<ClaudeResult<ExtractedRecipe>> = async () => ({ output: EXTRACTED, usage: USAGE });
  onVerify: () => Promise<ClaudeResult<RecipeWarning[]>> = async () => ({ output: VERIFIER_WARNINGS, usage: USAGE });

  extract(transcript: Transcript): Promise<ClaudeResult<ExtractedRecipe>> {
    this.extractCalls++;
    this.extractedFrom.push(transcript);
    return this.onExtract();
  }
  verify(_transcript: Transcript, _recipe: ExtractedRecipe): Promise<ClaudeResult<RecipeWarning[]>> {
    this.verifyCalls++;
    return this.onVerify();
  }
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    anthropicApiKey: "test-key-not-real",
    extractorModel: "claude-haiku-4-5",
    verifierModel: "claude-haiku-4-5",
    dailyBudgetUsd: 2,
    freeMonthlyRecipes: 3,
    allowedOrigins: ["https://recipe-transcriber.pages.dev"],
    requireAppCheck: false,
    ...overrides,
  };
}

/** A mutable clock the app reads through `now()`. */
export class TestClock {
  constructor(public current: Date) {}
  now = (): Date => new Date(this.current);
  set(iso: string): void {
    this.current = new Date(iso);
  }
}

/** Response bodies in tests are inspected loosely; the contract schemas are parsed where it matters. */
export function json(res: Response): Promise<any> {
  return res.json();
}
