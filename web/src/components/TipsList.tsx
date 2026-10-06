import type { Tip } from "@recipe/shared";
import { TimestampButton } from "@/components/TimestampButton";
import { Lightbulb } from "lucide-react";

export function TipsList({
  tips,
  onSeek,
}: {
  tips: Tip[];
  onSeek: (seconds: number) => void;
}) {
  if (tips.length === 0) return null;

  return (
    <div className="rounded-[10px] bg-[hsl(var(--accent-tint)/0.5)] px-4 py-3.5 space-y-2.5">
      <h3 className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">
        <Lightbulb className="h-3.5 w-3.5" />
        Notes
      </h3>
      <ul className="space-y-2">
        {tips.map((tip, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-[hsl(var(--ink-muted))]">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[hsl(var(--ink-faint))]" />
            <span className="flex-1">{tip.text}</span>
            <TimestampButton seconds={tip.timestamp} onSeek={onSeek} />
          </li>
        ))}
      </ul>
    </div>
  );
}
