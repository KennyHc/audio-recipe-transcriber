// Cloud mode's stand-in for ./claude.ts / ./proxyClaude.ts (see ./claudeProvider.ts). In cloud
// mode the browser never calls Claude — the API does (shared/cloud.ts) — and the runner's finish
// step is replaced, so these are unreachable; they throw rather than silently do nothing.

import type { ExtractedRecipe, RecipeWarning } from "@recipe/shared";

export class ExtractionError extends Error {}
export class VerificationError extends Error {}

export async function extractRecipe(): Promise<ExtractedRecipe> {
  throw new ExtractionError("Recipes are made by the server in this version of the app.");
}

export async function verifyRecipe(): Promise<RecipeWarning[]> {
  throw new VerificationError("Recipes are checked by the server in this version of the app.");
}
