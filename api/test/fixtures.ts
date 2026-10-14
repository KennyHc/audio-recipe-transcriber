import type { ExtractedRecipe, PublishAssistOutput, RecipeWarning, ScreeningOutput, Transcript } from "@recipe/shared";
import type { ClaudeResult, ClaudeService } from "../src/claude/types";
import type { Config } from "../src/config";
import type { ClaudeUsage } from "../src/cost";
import type { FetchLike } from "../src/sources";

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
  screenCalls = 0;
  /** User messages passed to screen(), in call order. */
  screened: string[] = [];
  suggestCalls = 0;
  /** User messages passed to suggest(), in call order. */
  suggested: string[] = [];
  onSuggest: () => Promise<ClaudeResult<PublishAssistOutput>> = async () => ({
    output: { tags: ["chinese", "dinner", "not-a-tag"], creditMatches: true, creditNote: null },
    usage: SCREEN_USAGE,
  });
  /** Transcripts passed to extract(), in call order. */
  extractedFrom: Transcript[] = [];
  onExtract: () => Promise<ClaudeResult<ExtractedRecipe>> = async () => ({ output: EXTRACTED, usage: USAGE });
  onVerify: () => Promise<ClaudeResult<RecipeWarning[]>> = async () => ({ output: VERIFIER_WARNINGS, usage: USAGE });
  onScreen: () => Promise<ClaudeResult<ScreeningOutput>> = async () => ({
    output: { decision: "ok", reason: "ordinary recipe" },
    usage: SCREEN_USAGE,
  });

  extract(transcript: Transcript): Promise<ClaudeResult<ExtractedRecipe>> {
    this.extractCalls++;
    this.extractedFrom.push(transcript);
    return this.onExtract();
  }
  verify(_transcript: Transcript, _recipe: ExtractedRecipe): Promise<ClaudeResult<RecipeWarning[]>> {
    this.verifyCalls++;
    return this.onVerify();
  }
  screen(userMessage: string): Promise<ClaudeResult<ScreeningOutput>> {
    this.screenCalls++;
    this.screened.push(userMessage);
    return this.onScreen();
  }
  suggest(userMessage: string): Promise<ClaudeResult<PublishAssistOutput>> {
    this.suggestCalls++;
    this.suggested.push(userMessage);
    return this.onSuggest();
  }
}

export const SCREEN_USAGE: ClaudeUsage = { inputTokens: 600, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };

/**
 * Fake outgoing fetch: answers the YouTube/TikTok oEmbed endpoints and TikTok short-link
 * redirects from in-memory tables, and records every URL. Anything else → throws, so a test
 * that would hit some other host fails loudly.
 */
export const SITE_INDEX_HTML =
  '<!doctype html><html><head><meta charset="UTF-8" /><title>Recipe Transcriber</title>' +
  '<meta name="description" content="Homepage" /><meta property="og:title" content="Homepage" />' +
  '<meta property="og:image" content="https://site.example/og-image.png" /><meta name="twitter:card" content="summary_large_image" />' +
  '</head><body><div id="root"></div></body></html>';

export class FakeFetch {
  calls: string[] = [];
  /** Video ids whose oEmbed lookup returns this status (default: 200 with generated credit). */
  oembedStatus = new Map<string, number>();
  /** Short-link URL → Location header of a 301. */
  redirects = new Map<string, string>();
  /** Makes every call fail like a network error/timeout. */
  down = false;

  fn: FetchLike = async (input) => {
    this.calls.push(input);
    if (this.down) throw new Error("network down");
    const url = new URL(input);
    if (url.origin === "https://www.youtube.com" && url.pathname === "/oembed") {
      const id = new URL(url.searchParams.get("url")!).searchParams.get("v")!;
      return this.oembed(id, {
        title: `Fried rice video ${id}`,
        author_name: "Chef YouTube",
        author_url: "https://www.youtube.com/@chef",
        thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      });
    }
    if (url.origin === "https://www.tiktok.com" && url.pathname === "/oembed") {
      const target = new URL(url.searchParams.get("url")!);
      const id = target.pathname.split("/").pop()!;
      return this.oembed(id, {
        title: `TikTok noodles ${id}`,
        author_name: "Chef TikTok",
        author_url: "https://www.tiktok.com/@cheftok",
        thumbnail_url: `https://p16.tiktokcdn.com/${id}.jpeg`,
      });
    }
    // The Hosting site's index.html (GET /r/:id link previews; testConfig's publicSiteOrigin).
    if (url.origin === "https://site.example" && url.pathname === "/index.html") {
      return new Response(SITE_INDEX_HTML, { status: 200, headers: { "Content-Type": "text/html" } });
    }
    const location = this.redirects.get(input);
    if (location) return new Response(null, { status: 301, headers: { Location: location } });
    throw new Error(`FakeFetch: unexpected request to ${url.host}`);
  };

  private oembed(id: string, body: Record<string, string>): Response {
    const status = this.oembedStatus.get(id) ?? 200;
    if (status !== 200) return new Response("nope", { status });
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    anthropicApiKey: "test-key-not-real",
    extractorModel: "claude-haiku-4-5",
    verifierModel: "claude-haiku-4-5",
    screeningModel: "claude-haiku-4-5",
    dailyBudgetUsd: 2,
    freeMonthlyRecipes: 3,
    allowedOrigins: ["https://recipe-transcriber.pages.dev"],
    requireAppCheck: false,
    reportSalt: "test-salt-not-real",
    publicSiteOrigin: "https://site.example",
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
