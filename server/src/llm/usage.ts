// Token usage for API-backend calls, so evals can report what a recipe really costs.
// (The CLI backend bills the user's subscription, so it isn't recorded here.)

export interface UsageRecord {
  stage: "extract" | "verify";
  model: string;
  inputTokens: number;
  outputTokens: number; // includes thinking tokens, which bill as output
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

// USD per million tokens (Claude API list prices). Unknown models report cost as null.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

const records: UsageRecord[] = [];

export function recordUsage(record: UsageRecord): void {
  records.push(record);
}

/** Returns and clears everything recorded since the last call. */
export function takeUsage(): UsageRecord[] {
  return records.splice(0);
}

export function priceFor(model: string): { input: number; output: number } | null {
  return PRICES[model.replace(/-\d{8}$/, "")] ?? null;
}

export function costUsd(usage: UsageRecord[]): number | null {
  let total = 0;
  for (const u of usage) {
    const p = priceFor(u.model);
    if (!p) return null;
    // Cache reads bill at 0.1x input, 5-minute cache writes at 1.25x.
    total +=
      (u.inputTokens * p.input +
        u.cacheReadTokens * p.input * 0.1 +
        u.cacheWriteTokens * p.input * 1.25 +
        u.outputTokens * p.output) /
      1_000_000;
  }
  return total;
}
