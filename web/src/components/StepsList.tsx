import type { Step, RecipeWarning } from "@recipe/shared";
import { convertTemperatureText, type UnitSystem } from "@/lib/units";
import { formatDuration } from "@/lib/format";
import { TimestampButton } from "@/components/TimestampButton";
import { StatusPill } from "@/components/StatusPill";
import { Clock, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";

export function StepsList({
  steps,
  unitSystem,
  warnings,
  onSeek,
  currentTime,
}: {
  steps: Step[];
  unitSystem: UnitSystem;
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

        return (
          <li
            id={`step-${i}`}
            key={i}
            className={cn(
              "flex gap-4 sm:gap-5 border-t border-[hsl(var(--border))] py-7 sm:py-8 first:border-t-0 first:pt-0 transition-colors scroll-mt-24",
              highlighted && "rounded-[10px] border-t-transparent -mx-3 sm:-mx-4 px-3 sm:px-4",
              targetWarnings.length > 0 && "bg-[hsl(var(--caution-tint))]",
              isActive && "bg-[hsl(var(--accent-tint))] border-l-2 border-l-[hsl(var(--accent-fill))]",
            )}
          >
            <span className="w-8 sm:w-10 shrink-0 text-right font-serif text-[26px] sm:text-[28px] leading-none text-[hsl(var(--accent-text))]">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0 space-y-2 pt-1">
              <p className="max-w-[70ch] text-[15px] sm:text-[17px] leading-[1.6]">
                {convertTemperatureText(step.text, unitSystem)}
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
