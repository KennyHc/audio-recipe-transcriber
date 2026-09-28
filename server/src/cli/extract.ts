// npm run extract -w server -- <transcript.json>
//
// Runs extract+verify on a Transcript JSON file and prints the resulting
// Recipe JSON to stdout. No job storage involved — useful for iterating on
// prompts against eval/fixtures without touching data/.

import { readFile } from "node:fs/promises";
import { Transcript, type Recipe } from "@recipe/shared";
import { extractRecipe, ExtractionError } from "../pipeline/extract.ts";
import { CLAUDE_BACKEND } from "../config.ts";
import { verifyRecipe, VerificationError } from "../pipeline/verify.ts";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run extract -w server -- <transcript.json>");
    process.exit(1);
  }

  if (CLAUDE_BACKEND === "api" && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      "CLAUDE_BACKEND=api but ANTHROPIC_API_KEY is not set. Set it in .env, or use CLAUDE_BACKEND=cli.",
    );
    process.exit(1);
  }

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    console.error(`Could not read ${filePath}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error(`${filePath} is not valid JSON: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const parsed = Transcript.safeParse(json);
  if (!parsed.success) {
    console.error(`${filePath} is not a valid Transcript: ${parsed.error.message}`);
    process.exit(1);
  }

  try {
    const extracted = await extractRecipe(parsed.data);

    let warnings: Recipe["warnings"];
    try {
      warnings = await verifyRecipe(parsed.data, extracted);
    } catch (err) {
      const message = err instanceof VerificationError ? err.message : String(err);
      console.error(`Warning: verification failed, continuing without it: ${message}`);
      warnings = [];
    }

    const recipe: Recipe = { ...extracted, warnings };
    console.log(JSON.stringify(recipe, null, 2));
  } catch (err) {
    if (err instanceof ExtractionError) {
      console.error(`Extraction failed: ${err.message}`);
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  }
}

void main();
