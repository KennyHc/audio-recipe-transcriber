import type { JobStatus } from "@recipe/shared";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS: { status: JobStatus; label: string }[] = [
  { status: "transcribing", label: "Transcribing" },
  { status: "extracting", label: "Extracting recipe" },
  { status: "verifying", label: "Checking" },
  { status: "done", label: "Done" },
];

function stepIndex(status: JobStatus): number {
  if (status === "queued") return -1;
  return STEPS.findIndex((s) => s.status === status);
}

export function Stepper({ status }: { status: JobStatus }) {
  const current = stepIndex(status);

  return (
    <ol className="flex flex-col sm:flex-row gap-4 sm:gap-2 sm:items-center">
      {STEPS.map((step, i) => {
        const isDone = current > i || status === "done";
        const isActive = current === i && status !== "done";
        return (
          <li key={step.status} className="flex items-center gap-2.5 flex-1">
            <span
              className={cn(
                "flex h-3 w-3 shrink-0 items-center justify-center rounded-full transition-colors",
                isDone
                  ? "bg-[hsl(var(--accent-fill))]"
                  : isActive
                    ? "bg-[hsl(var(--accent-fill))] animate-pulse-dot"
                    : "bg-[hsl(var(--border-strong))]",
              )}
            >
              {isDone && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
            </span>
            <span
              className={cn(
                "text-sm font-medium",
                isActive || isDone ? "text-[hsl(var(--ink))]" : "text-[hsl(var(--ink-muted))]",
              )}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="hidden sm:block flex-1 h-px bg-[hsl(var(--border))] mx-2" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
