// Gentle nudges to grow the public bank (cloud mode): "Share your first recipe" in the Library,
// and "Recipe ready — share it in the bank?" on a recipe that just finished. Visibility rules
// are pure (unit-tested); what was dismissed is remembered per browser in localStorage.

import type { Job } from "@recipe/shared";

const KEY = "recipe-transcriber:nudges";
/** Recipes whose "ready" note was already shown/dismissed (oldest dropped past this). */
const MAX_REMEMBERED = 200;

interface NudgeState {
  shareFirstDismissed?: boolean;
  readySeen?: string[];
}

let memory: NudgeState = {};

function read(): NudgeState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as NudgeState) : {};
  } catch {
    return memory;
  }
}

function write(state: NudgeState): void {
  memory = state;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — lasts for this page */
  }
}

export function isShareFirstDismissed(): boolean {
  return read().shareFirstDismissed === true;
}

export function dismissShareFirst(): void {
  write({ ...read(), shareFirstDismissed: true });
}

export function wasReadyNoteSeen(recipeId: string): boolean {
  return (read().readySeen ?? []).includes(recipeId);
}

export function markReadyNoteSeen(recipeId: string): void {
  const state = read();
  const seen = (state.readySeen ?? []).filter((id) => id !== recipeId);
  seen.push(recipeId);
  write({ ...state, readySeen: seen.slice(-MAX_REMEMBERED) });
}

/**
 * The Library's "Share your first recipe" card: the user has at least one finished recipe and
 * nothing published (in any status), we know that for sure (`publishedLoaded`), and they
 * haven't dismissed it. Returns the recipe its button publishes (the most recent finished
 * one), or null when the card shouldn't show.
 */
export function shareFirstTarget(input: {
  jobs: ReadonlyArray<Pick<Job, "id" | "status" | "createdAt">> | null;
  publishedCount: number;
  publishedLoaded: boolean;
  dismissed: boolean;
}): string | null {
  if (input.dismissed || !input.publishedLoaded || input.publishedCount > 0 || !input.jobs) return null;
  const done = input.jobs.filter((j) => j.status === "done");
  if (done.length === 0) return null;
  const newest = done.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return newest.id;
}

/**
 * The recipe page's "Recipe ready — share it in the bank?" note: only right after the recipe
 * finished processing while the page was open, only when it isn't published, and once per
 * recipe (seen or dismissed before → never again).
 */
export function showReadyNote(input: { justFinished: boolean; published: boolean | undefined; seen: boolean }): boolean {
  return input.justFinished && input.published === false && !input.seen;
}
