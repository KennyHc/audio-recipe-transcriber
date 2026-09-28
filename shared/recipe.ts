import { z } from "zod";

// ---------------------------------------------------------------------------
// Transcript (produced by whisper.cpp, normalised by the server)
// ---------------------------------------------------------------------------

export const TranscriptSegment = z.object({
  start: z.number(), // seconds
  end: z.number(), // seconds
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

export const Transcript = z.object({
  language: z.string().nullable(),
  segments: z.array(TranscriptSegment),
});
export type Transcript = z.infer<typeof Transcript>;

// ---------------------------------------------------------------------------
// Recipe — the schema the Extractor agent must fill (structured output).
// Rules for LLM-facing schemas: use .nullable() not .optional(), and no
// min/max/length constraints (the API strips them).
// ---------------------------------------------------------------------------

export const Confidence = z.enum([
  "stated", // explicitly said in the audio
  "inferred", // not said, but strongly implied (e.g. "the flour" with no amount mentioned earlier)
  "vague", // said, but imprecise ("a splash", "some salt")
]);
export type Confidence = z.infer<typeof Confidence>;

export const Ingredient = z.object({
  quantity: z.number().nullable(), // 0.5 for "half"; null if none given
  unit: z.string().nullable(), // as spoken: "cup", "tbsp", "g", "clove"
  item: z.string(), // "garlic"
  prep: z.string().nullable(), // "minced"
  sourceText: z.string(), // verbatim words from the transcript
  timestamp: z.number().nullable(), // seconds; start of the segment it was said in
  confidence: Confidence,
});
export type Ingredient = z.infer<typeof Ingredient>;

export const Step = z.object({
  text: z.string(),
  timestamp: z.number().nullable(),
  durationMinutes: z.number().nullable(),
  temperature: z.string().nullable(), // as spoken: "180°C", "medium-high heat"
});
export type Step = z.infer<typeof Step>;

export const Tip = z.object({
  text: z.string(),
  timestamp: z.number().nullable(),
});
export type Tip = z.infer<typeof Tip>;

export const ExtractedRecipe = z.object({
  title: z.string(),
  description: z.string().nullable(),
  servings: z.number().nullable(),
  totalTimeMinutes: z.number().nullable(),
  ingredients: z.array(Ingredient),
  steps: z.array(Step),
  tips: z.array(Tip),
});
export type ExtractedRecipe = z.infer<typeof ExtractedRecipe>;

// ---------------------------------------------------------------------------
// Verifier agent output
// ---------------------------------------------------------------------------

export const WarningKind = z.enum([
  "missing_ingredient", // used in a step, absent from the ingredient list
  "unused_ingredient", // listed but never used in a step
  "conflict", // contradictory numbers/instructions in the audio
  "vague_quantity", // imprecise amount; `suggestion` holds a typical value
  "unsupported", // item not traceable to the transcript (possible hallucination)
  "other",
]);
export type WarningKind = z.infer<typeof WarningKind>;

export const RecipeWarning = z.object({
  kind: WarningKind,
  message: z.string(),
  // What it refers to, e.g. "ingredients[2]" or "steps[4]"; null if general.
  target: z.string().nullable(),
  suggestion: z.string().nullable(), // never auto-applied; shown to the user
});
export type RecipeWarning = z.infer<typeof RecipeWarning>;

export const VerifierOutput = z.object({
  warnings: z.array(RecipeWarning),
});
export type VerifierOutput = z.infer<typeof VerifierOutput>;

// ---------------------------------------------------------------------------
// Stored recipe = extracted + verifier warnings
// ---------------------------------------------------------------------------

export const Recipe = ExtractedRecipe.extend({
  warnings: z.array(RecipeWarning),
});
export type Recipe = z.infer<typeof Recipe>;
