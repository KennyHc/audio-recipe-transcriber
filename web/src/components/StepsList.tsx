import type { Step, RecipeWarning } from "@recipe/shared";
import { convertTemperatureText, type UnitSystem } from "@/lib/units";
import { formatDuration } from "@/lib/format";
import { scaleStepText } from "@/lib/stepQuantities";
import { TimestampButton } from "@/components/TimestampButton";
import { StatusPill } from "@/components/StatusPill";
import { StepText } from "@/components/StepText";
import { Clock, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";

export function StepsList({
  steps,
  unitSystem,
  scaleFactor,
  warnings,
  onSeek,
  currentTime,
}: {
  steps: Step[];
  unitSystem: UnitSystem;
  scaleFactor: number;
  warnings: RecipeWarning[];
  onSeek: (seconds: number) => void;
  currentTime: number | null;
}) {
  let activeIndex = -1;
  if (currentTime !== null) {
    steps.forEach((s, i) => {
      if (s.timestamp !== null && s.timestamp <= currentTime) activeIndex = i;
    });
  }

  return (
    <ol>
      {steps.map((step, i) => {
        const targetWarnings = warnings.filter((w) => w.target === `steps[${i}]`);
        const isActive = i === activeIndex;
        const highlighted = targetWarnings.length > 0 || isActive;
        const stepSegments = scaleStepText(convertTemperatureText(step.text, unitSystem), scaleFactor, unitSystem);

        return (
          <li
            id={`step-${i}`}
            key={i}
            className={cn(
              // The divider is a pseudo-element inset to the column edges, so it lines up with
              // the rest of the page even though the row bleeds out for its hover background.
              "relative flex gap-3 sm:gap-4 rounded-[10px] -mx-3 sm:-mx-4 px-3 sm:px-4 py-3 first:pt-0 transition-colors scroll-mt-24",
              "before:absolute before:top-0 before:inset-x-3 sm:before:inset-x-4 before:h-px before:bg-[hsl(var(--border))] first:before:hidden",
              highlighted && "before:hidden",
              targetWarnings.length > 0 && "bg-[hsl(var(--caution-tint))]",
              isActive && "bg-[hsl(var(--accent-tint))] border-l-2 border-l-[hsl(var(--accent-fill))]",
              !highlighted && "hover:bg-[hsl(var(--sunken))]",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent-tint-strong))] font-sans text-[14px] font-semibold tabular-nums leading-none text-[hsl(var(--accent-text))]">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0 space-y-1.5 pt-0.5">
              <p className="max-w-[70ch] text-[15px] sm:text-[17px] leading-[1.6]">
                <StepText segments={stepSegments} />
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {step.durationMinutes !== null && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--sunken))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--ink-muted))]">
                    <Clock className="h-3 w-3" />
                    {formatDuration(step.durationMinutes)}
                  </span>
                )}
                {step.temperature && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--sunken))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--ink-muted))]">
                    <Thermometer className="h-3 w-3" />
                    {convertTemperatureText(step.temperature, unitSystem)}
                  </span>
                )}
                <TimestampButton seconds={step.timestamp} onSeek={onSeek} active={isActive} />
                <StatusPill warnings={targetWarnings} />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
