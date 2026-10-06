import { Play } from "lucide-react";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

export function TimestampButton({
  seconds,
  onSeek,
  active,
  className,
}: {
  seconds: number | null;
  onSeek: (seconds: number) => void;
  active?: boolean;
  className?: string;
}) {
  if (seconds === null) return null;
  return (
    <button
      type="button"
      onClick={() => onSeek(seconds)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums text-[hsl(var(--ink-faint))] transition-colors hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--accent-text))]",
        active && "bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]",
        className,
      )}
      aria-label={`Play from ${formatTimestamp(seconds)}`}
    >
      <Play className="h-3 w-3 fill-current" />
      {formatTimestamp(seconds)}
    </button>
  );
}
