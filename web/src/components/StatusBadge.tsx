import type { JobStatus } from "@recipe/shared";
import { cn } from "@/lib/utils";

const LABELS: Record<JobStatus, string> = {
  queued: "Queued",
  transcribing: "Transcribing",
  extracting: "Extracting",
  verifying: "Checking",
  done: "Ready",
  error: "Error",
};

const DOT_CLASS: Record<JobStatus, string> = {
  queued: "bg-[hsl(var(--ink-faint))]",
  transcribing: "bg-[hsl(var(--accent-fill))] animate-pulse-dot",
  extracting: "bg-[hsl(var(--accent-fill))] animate-pulse-dot",
  verifying: "bg-[hsl(var(--accent-fill))] animate-pulse-dot",
  done: "bg-[hsl(var(--accent-fill))]",
  error: "bg-[hsl(var(--danger))]",
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASS[status])} />
      <span className={cn(status === "error" && "text-[hsl(var(--danger))]")}>
        {LABELS[status]}
      </span>
    </span>
  );
}
