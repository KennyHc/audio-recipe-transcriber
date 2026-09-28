import type { Transcript } from "@recipe/shared";
import { formatTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

export function TranscriptView({
  transcript,
  currentTime,
  onSeek,
}: {
  transcript: Transcript;
  currentTime: number | null;
  onSeek: (seconds: number) => void;
}) {
  if (transcript.segments.length === 0) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">No transcript segments.</p>;
  }

  return (
    <div className="space-y-1">
      {transcript.segments.map((seg, i) => {
        const isActive =
          currentTime !== null && currentTime >= seg.start && currentTime < seg.end;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSeek(seg.start)}
            className={cn(
              "flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[hsl(var(--accent))]",
              isActive && "bg-[hsl(var(--accent))]",
            )}
          >
            <span
              className={cn(
                "mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
                isActive
                  ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]"
                  : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]",
              )}
            >
              {formatTimestamp(seg.start)}
            </span>
            <span className="text-sm leading-relaxed">{seg.text.trim()}</span>
          </button>
        );
      })}
    </div>
  );
}
