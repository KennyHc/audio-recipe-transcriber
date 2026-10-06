import { Check } from "lucide-react";
import type { MatchedIngredient } from "@/lib/cook";
import { convertQuantity, type UnitSystem } from "@/lib/units";
import { formatQuantity, formatUnit } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Chips for the ingredients a cook-mode step slide mentions; tapping toggles it done,
 * mirroring the checklist on the ingredients slide / recipe page. */
export function IngredientChips({
  matches,
  unitSystem,
  scaleFactor,
  checked,
  onToggle,
}: {
  matches: MatchedIngredient[];
  unitSystem: UnitSystem;
  scaleFactor: number;
  checked: Set<number>;
  onToggle: (index: number) => void;
}) {
  if (matches.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {matches.map(({ ingredient, index }) => {
        const scaledQty = ingredient.quantity !== null ? ingredient.quantity * scaleFactor : null;
        const converted = convertQuantity(scaledQty, ingredient.unit, unitSystem);
        const qtyLabel = formatQuantity(converted.quantity);
        const unitLabel = formatUnit(converted.unit, converted.quantity);
        const isChecked = checked.has(index);

        return (
          <button
            key={index}
            type="button"
            onClick={() => onToggle(index)}
            data-checked={isChecked}
            aria-pressed={isChecked}
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
              isChecked
                ? "border-transparent bg-[hsl(var(--sunken))] text-[hsl(var(--ink-faint))]"
                : "border-[hsl(var(--border-strong))] bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]",
            )}
          >
            <span className="chip-checkmark">
              <Check className="h-3 w-3" />
            </span>
            <span className="checkbox-strike" data-checked={isChecked}>
              {qtyLabel && <span>{qtyLabel} </span>}
              {unitLabel && <span>{unitLabel} </span>}
              <span>{ingredient.item}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
