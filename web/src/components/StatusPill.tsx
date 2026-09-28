import type { Confidence, RecipeWarning } from "@recipe/shared";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Short pill label per warning kind — keeps the visible signal to one or two words;
// the full sentence (and suggestion) lives in the popover.
const WARNING_LABEL: Record<RecipeWarning["kind"], string> = {
  missing_ingredient: "missing",
  unused_ingredient: "unused",
  conflict: "conflict",
  vague_quantity: "vague",
  unsupported: "unverified",
  other: "check",
};

/**
 * A single consolidated status signal for an ingredient or step: combines extractor
 * confidence (vague/inferred) and any verifier warnings targeting this item into one
 * pill. The reason (source quote, warning message, suggestion) lives behind a popover
 * so it doesn't compete on the row — but the popover is keyboard- and tap-accessible
 * (Radix Popover), unlike a hover-only tooltip.
 */
export function StatusPill({
  confidence,
  sourceText,
  warnings,
}: {
  confidence?: Confidence;
  sourceText?: string | null;
  warnings: RecipeWarning[];
}) {
  const hasWarnings = warnings.length > 0;
  const hasConfidence = confidence !== undefined && confidence !== "stated";
  if (!hasWarnings && !hasConfidence) return null;

  const label = hasWarnings
    ? warnings.length === 1
      ? WARNING_LABEL[warnings[0].kind]
      : `${warnings.length} to check`
    : (confidence as string);

  const variant: BadgeProps["variant"] =
    hasWarnings || confidence === "vague" ? "caution" : "muted";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex cursor-pointer">
          <Badge variant={variant}>{label}</Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="space-y-2">
        {sourceText && (
          <p className="text-xs italic text-[hsl(var(--ink-muted))]">&ldquo;{sourceText}&rdquo;</p>
        )}
        {hasWarnings && (
          <ul className="space-y-1.5">
            {warnings.map((w, i) => (
              <li key={i} className="text-xs text-[hsl(var(--caution-text))]">
                {w.message}
                {w.suggestion && (
                  <span className="text-[hsl(var(--ink-muted))]"> — {w.suggestion}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
