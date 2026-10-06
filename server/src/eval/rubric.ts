import { z } from "zod";
import { WarningKind } from "@recipe/shared";

// eval/cases/<name>/expected.json — a rubric, not an exact recipe. Wording varies run to
// run, so we check the things that matter: the right ingredients with the right amounts,
// nothing invented, steps in a sensible order, and warnings where the audio was vague.
//
// Matching rules (implemented in score.ts):
// - Item names match case-insensitively if the extracted `item` contains the expected
//   `item` or any alias as a whole word (plural "s"/"es" tolerated): "green onions" matches
//   "green onion"; "avocado oil" matches "oil".
// - Units normalise: tbsp/tablespoon(s), tsp/teaspoon(s), cup(s), g/gram(s), clove(s), ...
// - Each extracted ingredient can satisfy at most one expected ingredient (greedy, most
//   specific expectation first), so two "oil" expectations need two oil entries.

export const ExpectedIngredient = z.object({
  item: z.string(),
  aliases: z.array(z.string()).default([]),
  // Omitted = don't check. null = must be null (amount never stated).
  quantity: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  // If set, the extracted confidence must be one of these.
  confidence: z.array(z.enum(["stated", "inferred", "vague"])).optional(),
  // Optional ingredients count toward precision if present but are not required.
  optional: z.boolean().default(false),
  note: z.string().optional(),
});
export type ExpectedIngredient = z.infer<typeof ExpectedIngredient>;

export const Rubric = z.object({
  description: z.string(), // what this case is testing
  // All must appear in the title (case-insensitive); "a|b" means either a or b.
  titleKeywords: z.array(z.string()),
  servings: z.number().nullable().optional(),
  ingredients: z.array(ExpectedIngredient),
  // Mentioned in the audio but must NOT be listed as ingredients (tangents, options the
  // cook explicitly skipped, other dishes, sponsor products).
  forbiddenIngredients: z.array(z.string()),
  // Each entry is a list of alternative keywords; each group must be found in some step,
  // and the matched steps must appear in this order.
  stepsInOrder: z.array(z.array(z.string())),
  // Each entry: keywords, at least one of which must appear in some warning's
  // message/suggestion/target-ingredient name.
  mustWarnAbout: z.array(z.array(z.string())),
  // False alarms: no warning of one of these kinds may mention any of these keywords
  // (in its message, suggestion, or targeted ingredient). E.g. an "unused_ingredient"
  // warning about oil that a step clearly uses.
  mustNotWarn: z
    .array(z.object({ kinds: z.array(WarningKind), about: z.array(z.string()) }))
    .default([]),
});
export type Rubric = z.infer<typeof Rubric>;
