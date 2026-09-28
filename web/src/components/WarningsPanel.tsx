import { useState } from "react";
import type { RecipeWarning } from "@recipe/shared";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { scrollToTarget } from "@/lib/target";
import { cn } from "@/lib/utils";

export function WarningsPanel({ warnings }: { warnings: RecipeWarning[] }) {
  const [open, setOpen] = useState(false);

  if (warnings.length === 0) return null;

  return (
    <div className="rounded-[10px] border border-[hsl(var(--caution-border))] bg-[hsl(var(--caution-tint))]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-[hsl(var(--caution-text))]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {warnings.length} thing{warnings.length === 1 ? "" : "s"} to double-check
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[hsl(var(--caution-text))] transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <ul className="space-y-1.5 px-4 pb-3 pl-[2.375rem]">
          {warnings.map((w, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => scrollToTarget(w.target)}
                className="text-left text-sm text-[hsl(var(--caution-text))] hover:underline decoration-dotted underline-offset-2"
              >
                <span>{w.message}</span>
                {w.suggestion && <span className="text-[hsl(var(--ink-muted))]"> — {w.suggestion}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
