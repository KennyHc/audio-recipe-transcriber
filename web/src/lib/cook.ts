// Cook-mode helpers: matching ingredients mentioned in a step, and computing
// the audio range to play for "Hear this step".

import type { Ingredient, Step } from "@recipe/shared";

/** Very small English singularizer — good enough for matching ingredient words. */
function singularize(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3) return w;
  if (/[^aeiou]ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (/[^aeiou]oes$/.test(w)) return w.slice(0, -2);
  if (/ss$/.test(w)) return w;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

function lastWord(item: string): string {
  const words = item.trim().split(/\s+/);
  return words[words.length - 1] ?? item;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

export interface MatchedIngredient {
  ingredient: Ingredient;
  index: number;
}

/**
 * Which ingredients a step's text mentions: whole-word, case-insensitive match on the
 * ingredient's item text (or its last word, for multi-word items like "red bell pepper"
 * -> "pepper"), plural-tolerant in both directions. Each ingredient is returned at most
 * once, in ingredient-list order.
 */
export function ingredientsForStep(stepText: string, ingredients: Ingredient[]): MatchedIngredient[] {
  const tokens = tokenize(stepText);
  if (tokens.length === 0) return [];

  const tokenSet = new Set(tokens);
  const singularTokenSet = new Set(tokens.map(singularize));

  const results: MatchedIngredient[] = [];
  ingredients.forEach((ingredient, index) => {
    const term = lastWord(ingredient.item).toLowerCase();
    if (!term) return;
    const singularTerm = singularize(term);
    if (tokenSet.has(term) || singularTokenSet.has(singularTerm) || singularTokenSet.has(term)) {
      results.push({ ingredient, index });
    }
  });
  return results;
}

export interface AudioRange {
  start: number;
  end: number;
}

export type CookRouteAction = "open" | "close" | "confirm-and-restore" | "noop";

/**
 * What to do when the route's cook flag changes relative to cook mode's own open state —
 * covers both opening (route gained /cook, e.g. deep link or the Cook button) and the
 * browser back button navigating away from /cook. When timers are running/paused, we
 * don't want a stray back-button press to silently lose them: the caller restores the
 * /cook hash (replacing, not pushing) and shows its own exit-confirmation UI instead of
 * unmounting cook mode immediately.
 */
export function decideCookRouteAction({
  cookRoute,
  cookOpen,
  hasActiveTimers,
}: {
  cookRoute: boolean;
  cookOpen: boolean;
  hasActiveTimers: boolean;
}): CookRouteAction {
  if (cookRoute) return cookOpen ? "noop" : "open";
  if (!cookOpen) return "noop";
  return hasActiveTimers ? "confirm-and-restore" : "close";
}

/**
 * The audio range to play for "Hear this step": from this step's timestamp to the next
 * step's timestamp (or the end of the audio if this is the last timestamped step).
 * Returns null if the step itself has no timestamp.
 */
export function stepAudioRange(steps: Step[], index: number, duration: number): AudioRange | null {
  const step = steps[index];
  if (!step || step.timestamp === null) return null;

  let end = duration;
  for (let j = index + 1; j < steps.length; j++) {
    const next = steps[j];
    if (next.timestamp !== null) {
      end = next.timestamp;
      break;
    }
  }
  return { start: step.timestamp, end };
}
