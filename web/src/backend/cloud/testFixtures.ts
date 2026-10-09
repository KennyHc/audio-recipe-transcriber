// Shared fixtures for the cloud-mode tests.
import type { CloudRecipe, Recipe, Transcript, Usage, VersionedRecipe } from "@recipe/shared";

export const transcript: Transcript = {
  language: "en",
  segments: [
    { start: 0, end: 4, text: "Two cups of flour" },
    { start: 4, end: 8, text: "Mix it well" },
  ],
};

export function recipe(title: string): Recipe {
  return {
    title,
    description: null,
    servings: null,
    totalTimeMinutes: null,
    ingredients: [
      { quantity: 2, unit: "cup", item: "flour", prep: null, sourceText: "Two cups of flour", timestamp: 0, confidence: "stated" },
    ],
    steps: [{ text: "Mix the flour.", timestamp: 4, durationMinutes: null, temperature: null }],
    tips: [],
    warnings: [],
  };
}

export function cloudRecipe(id: string, title: string, updatedAt: string, currentVersion = 1): CloudRecipe {
  return {
    id,
    ownerId: "alice",
    visibility: "private",
    title,
    fileName: `${id}.mp3`,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt,
    currentVersion,
    latest: recipe(title),
  };
}

export function versioned(version: number, title: string, source: VersionedRecipe["meta"]["source"] = "extracted"): VersionedRecipe {
  return { meta: { version, source, createdAt: "2026-10-01T10:00:00.000Z", note: null }, recipe: recipe(title) };
}

export const usage: Usage = {
  month: "2026-10",
  used: 5,
  limit: 30,
  remaining: 25,
  resetsAt: "2026-11-01T00:00:00.000Z",
};
