import type { UnitSystem } from "@/lib/units";
import { cn } from "@/lib/utils";

const OPTIONS: { value: UnitSystem; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "metric", label: "Metric" },
  { value: "imperial", label: "Imperial" },
];

export function UnitsToggle({
  value,
  onChange,
}: {
  value: UnitSystem;
  onChange: (v: UnitSystem) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Units"
      className="inline-flex rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] p-0.5"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1 text-sm rounded-full font-medium transition-colors",
            value === opt.value
              ? "bg-[hsl(var(--surface))] text-[hsl(var(--ink))] shadow-sm"
              : "text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))]",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
