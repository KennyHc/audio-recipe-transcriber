import { Minus, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatQuantity } from "@/lib/format";

export function ServingsScaler({
  originalServings,
  factor,
  onFactorChange,
}: {
  originalServings: number | null;
  factor: number;
  onFactorChange: (f: number) => void;
}) {
  if (originalServings !== null) {
    const current = Math.max(1, Math.round(originalServings * factor));
    return (
      <div className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] py-0.5 pl-2.5 pr-1">
        <Users className="h-3.5 w-3.5 text-[hsl(var(--ink-muted))]" />
        <span className="text-sm text-[hsl(var(--ink-muted))] mr-1">Servings</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-full"
          aria-label="Fewer servings"
          onClick={() => onFactorChange(Math.max(1, current - 1) / originalServings)}
          disabled={current <= 1}
        >
          <Minus className="h-3 w-3" />
        </Button>
        <span className="w-6 text-center text-sm font-medium tabular-nums">{current}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-full"
          aria-label="More servings"
          onClick={() => onFactorChange((current + 1) / originalServings)}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  // No servings given: factor acts as a plain multiplier, stepping by ½.
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] py-0.5 pl-2.5 pr-1">
      <Users className="h-3.5 w-3.5 text-[hsl(var(--ink-muted))]" />
      <span className="text-sm text-[hsl(var(--ink-muted))] mr-1">Amount</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 rounded-full"
        aria-label="Decrease"
        onClick={() => onFactorChange(Math.max(0.5, factor - 0.5))}
        disabled={factor <= 0.5}
      >
        <Minus className="h-3 w-3" />
      </Button>
      <span className="min-w-8 text-center text-sm font-medium tabular-nums">
        ×{formatQuantity(factor)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 rounded-full"
        aria-label="Increase"
        onClick={() => onFactorChange(factor + 0.5)}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
