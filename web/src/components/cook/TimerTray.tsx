import { Pause, Play, X } from "lucide-react";
import type { TimerState } from "@/lib/timers";
import { formatMs, remainingMs } from "@/lib/timers";
import { cn } from "@/lib/utils";

/** Slim tray of running/paused/finished timers, shown above cook mode's bottom nav. */
export function TimerTray({
  timers,
  now,
  onPause,
  onResume,
  onCancel,
  onDismiss,
}: {
  timers: TimerState[];
  now: number;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (timers.length === 0) return null;

  return (
    <div className="no-print border-t border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 sm:px-8 py-2 space-y-1.5">
      <p className="text-[11px] uppercase tracking-[0.08em] text-[hsl(var(--ink-faint))]">
        Timers — running ones stop if you exit cook mode
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {timers.map((t) => (
          <li
            key={t.id}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5",
              t.status === "finished"
                ? "border-[hsl(var(--accent-fill))] bg-[hsl(var(--accent-tint))] animate-pulse"
                : "border-[hsl(var(--border))] bg-[hsl(var(--sunken))]",
            )}
          >
            <span className="max-w-[10rem] truncate text-sm">{t.label}</span>
            <span className="shrink-0 text-sm font-medium tabular-nums text-[hsl(var(--ink))]">
              {t.status === "finished" ? "Done" : formatMs(remainingMs(t, now))}
            </span>
            {t.status === "finished" ? (
              <button
                type="button"
                aria-label={`Dismiss ${t.label} timer`}
                onClick={() => onDismiss(t.id)}
                className="shrink-0 text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))]"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  aria-label={t.status === "running" ? `Pause ${t.label} timer` : `Resume ${t.label} timer`}
                  onClick={() => (t.status === "running" ? onPause(t.id) : onResume(t.id))}
                  className="shrink-0 text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))]"
                >
                  {t.status === "running" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  aria-label={`Cancel ${t.label} timer`}
                  onClick={() => onCancel(t.id)}
                  className="shrink-0 text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))]"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
