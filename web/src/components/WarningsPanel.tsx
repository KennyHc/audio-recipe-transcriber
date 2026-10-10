import { useState } from "react";
import type { RecipeWarning } from "@recipe/shared";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { scrollToTarget } from "@/lib/target";
import { cn } from "@/lib/utils";

/** "owner": the private recipe page ("3 things to double-check"). "public": a published recipe,
 * read by cooks — the same notes, framed as what the video didn't say exactly. */
export type WarningsAudience = "owner" | "public";

export function warningsSummary(count: number, audience: WarningsAudience): string {
  return audience === "public"
    ? `${count} note${count === 1 ? "" : "s"} from the video`
    : `${count} thing${count === 1 ? "" : "s"} to double-check`;
}

export const PUBLIC_WARNINGS_INTRO =
  "Things the video didn't say exactly — with a typical amount where we could suggest one.";

export function WarningsPanel({ warnings, audience = "owner" }: { warnings: RecipeWarning[]; audience?: WarningsAudience }) {
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
          {warningsSummary(warnings.length, audience)}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[hsl(var(--caution-text))] transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>
      {open && audience === "public" && (
        <p className="-mt-1 px-4 pb-2 pl-[2.375rem] text-xs text-[hsl(var(--ink-muted))]">{PUBLIC_WARNINGS_INTRO}</p>
      )}
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
