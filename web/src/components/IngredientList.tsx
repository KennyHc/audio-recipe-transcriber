import type { Ingredient, RecipeWarning } from "@recipe/shared";
import { convertQuantity, type UnitSystem } from "@/lib/units";
import { formatQuantity, formatUnit } from "@/lib/format";
import { StatusPill } from "@/components/StatusPill";
import { TimestampButton } from "@/components/TimestampButton";
import { cn } from "@/lib/utils";

export function IngredientList({
  ingredients,
  unitSystem,
  scaleFactor,
  warnings,
  onSeek,
  checked,
  onToggle,
}: {
  ingredients: Ingredient[];
  unitSystem: UnitSystem;
  scaleFactor: number;
  warnings: RecipeWarning[];
  onSeek: (seconds: number) => void;
  checked: Set<number>;
  onToggle: (i: number) => void;
}) {
  function toggle(i: number) {
    onToggle(i);
  }

  return (
    <ul className="space-y-1">
      {ingredients.map((ing, i) => {
        const scaledQty = ing.quantity !== null ? ing.quantity * scaleFactor : null;
        const converted = convertQuantity(scaledQty, ing.unit, unitSystem);
        const qtyLabel = formatQuantity(converted.quantity);
        const unitLabel = formatUnit(converted.unit, converted.quantity);
        const targetWarnings = warnings.filter((w) => w.target === `ingredients[${i}]`);
        const isChecked = checked.has(i);

        return (
          <li
            id={`ingredient-${i}`}
            key={i}
            className={cn(
              "flex items-start gap-3 rounded-md px-2 py-2 transition-colors scroll-mt-24",
              targetWarnings.length > 0 && "bg-[hsl(var(--caution-tint))]",
            )}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => toggle(i)}
              className="mt-1 h-4 w-4 shrink-0 rounded-[4px] accent-[hsl(var(--accent-fill))]"
              aria-label={`Mark ${ing.item} as done`}
            />
            <div className="flex-1 min-w-0">
              <label
                className={cn(
                  "block max-w-[70ch] text-sm sm:text-base cursor-pointer",
                  isChecked && "line-through text-[hsl(var(--muted-foreground))]",
                )}
                onClick={() => toggle(i)}
              >
                {qtyLabel && <span className="font-semibold tabular-nums">{qtyLabel} </span>}
                {unitLabel && <span className="font-semibold">{unitLabel} </span>}
                <span>{ing.item}</span>
                {ing.prep && <span className="text-[hsl(var(--muted-foreground))]">, {ing.prep}</span>}
              </label>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusPill confidence={ing.confidence} sourceText={ing.sourceText} warnings={targetWarnings} />
                <TimestampButton seconds={ing.timestamp} onSeek={onSeek} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
