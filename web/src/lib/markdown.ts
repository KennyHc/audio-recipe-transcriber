import type { Recipe } from "@recipe/shared";
import { convertQuantity, convertTemperatureText, type UnitSystem } from "@/lib/units";
import { formatQuantity, formatUnit, formatDuration } from "@/lib/format";

export function recipeToMarkdown(
  recipe: Recipe,
  unitSystem: UnitSystem,
  scaleFactor: number,
  scaledServings: number | null,
): string {
  const lines: string[] = [];
  lines.push(`# ${recipe.title}`);
  if (recipe.description) {
    lines.push("", recipe.description);
  }

  const meta: string[] = [];
  if (scaledServings !== null) meta.push(`Servings: ${scaledServings}`);
  if (recipe.totalTimeMinutes !== null) meta.push(`Total time: ${formatDuration(recipe.totalTimeMinutes)}`);
  if (meta.length) lines.push("", meta.join(" · "));

  lines.push("", "## Ingredients");
  for (const ing of recipe.ingredients) {
    const scaledQty = ing.quantity !== null ? ing.quantity * scaleFactor : null;
    const converted = convertQuantity(scaledQty, ing.unit, unitSystem);
    const qty = formatQuantity(converted.quantity);
    const unit = formatUnit(converted.unit, converted.quantity);
    const parts = [qty, unit, ing.item].filter(Boolean).join(" ");
    lines.push(`- ${parts}${ing.prep ? `, ${ing.prep}` : ""}`);
  }

  lines.push("", "## Steps");
  recipe.steps.forEach((step, i) => {
    const text = convertTemperatureText(step.text, unitSystem);
    const extras: string[] = [];
    if (step.durationMinutes !== null) extras.push(formatDuration(step.durationMinutes));
    if (step.temperature) extras.push(convertTemperatureText(step.temperature, unitSystem));
    lines.push(`${i + 1}. ${text}${extras.length ? ` (${extras.join(", ")})` : ""}`);
  });

  if (recipe.tips.length > 0) {
    lines.push("", "## Tips");
    for (const tip of recipe.tips) {
      lines.push(`- ${tip.text}`);
    }
  }

  return lines.join("\n");
}
