import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import type { StatsDay } from "@recipe/shared";
import { publicBank } from "@/backend";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  STATS_METRICS,
  STATS_RANGES,
  fillStatsRange,
  formatPct,
  formatStatsDate,
  formatStatsWeekday,
  funnel,
  niceMax,
  totalStats,
  utcDateString,
  type StatsMetric,
  type StatsRange,
} from "@/lib/adminStats";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; days: StatsDay[] };

const NUMBER = new Intl.NumberFormat();
const fmt = (n: number) => NUMBER.format(n);

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">{children}</h3>;
}

/** Anonymous daily totals for admins (shared/stats.ts): range picker, today so far, totals,
 * a visits → publishes funnel, a daily bar chart, and the daily numbers as a table. */
export function StatsSection() {
  const [range, setRange] = useState<StatsRange>(14);
  const [metric, setMetric] = useState<StatsMetric>("visit");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!publicBank) return;
    let cancelled = false;
    setLoad({ state: "loading" });
    publicBank
      .adminStats(range)
      .then((r) => !cancelled && setLoad({ state: "ready", days: fillStatsRange(r.days, range) }))
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ state: "error", message: err instanceof Error ? err.message : "Couldn't load the stats." });
      });
    return () => {
      cancelled = true;
    };
  }, [range, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <section aria-labelledby="stats-heading" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="stats-heading" className="font-serif text-[28px] sm:text-[32px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
            Stats
          </h2>
          <p className="text-sm text-[hsl(var(--ink-muted))]">Anonymous daily totals (UTC days). No cookies, ids, or per-person records.</p>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Range" className="inline-flex rounded-[8px] border border-[hsl(var(--border))] bg-[hsl(var(--sunken))] p-0.5">
            {STATS_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                onClick={() => setRange(r)}
                className={cn(
                  "h-8 rounded-[6px] px-3 text-sm tabular-nums transition-colors",
                  range === r
                    ? "bg-[hsl(var(--surface))] font-medium text-[hsl(var(--accent-text))] shadow-sm ring-1 ring-[hsl(var(--border-strong))]"
                    : "text-[hsl(var(--ink-muted))] hover:text-[hsl(var(--ink))]",
                )}
              >
                {r}d
              </button>
            ))}
          </div>
          <Button size="icon" variant="outline" onClick={refresh} aria-label="Refresh stats" className="h-9 w-9">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {load.state === "loading" ? (
        <div className="flex items-center gap-2 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 py-10 text-sm text-[hsl(var(--ink-muted))] justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading stats…
        </div>
      ) : load.state === "error" ? (
        <div role="alert" className="space-y-3 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-4 py-8 text-center">
          <p className="text-sm text-[hsl(var(--danger))]">{load.message}</p>
          <Button size="sm" variant="outline" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </Button>
        </div>
      ) : (
        <StatsBody days={load.days} range={range} metric={metric} onMetric={setMetric} />
      )}
    </section>
  );
}

function StatsBody({
  days,
  range,
  metric,
  onMetric,
}: {
  days: StatsDay[];
  range: StatsRange;
  metric: StatsMetric;
  onMetric: (m: StatsMetric) => void;
}) {
  const totals = useMemo(() => totalStats(days), [days]);
  const steps = useMemo(() => funnel(totals), [totals]);
  const todayDate = utcDateString(new Date());
  const today = days.find((d) => d.date === todayDate) ?? null;
  const empty = STATS_METRICS.every(({ key }) => totals[key] === 0);

  return (
    <div className="space-y-6">
      {today && (
        <div className="rounded-[10px] border border-[hsl(var(--caution-border))] bg-[hsl(var(--caution-tint))] p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[hsl(var(--caution-text))]">Today so far</p>
          <dl className="grid grid-cols-4 gap-x-3 gap-y-2 sm:grid-cols-7">
            {STATS_METRICS.map(({ key, short }) => (
              <div key={key} className="min-w-0">
                <dt className="truncate text-[11px] text-[hsl(var(--caution-text))]">{short}</dt>
                <dd className="text-lg font-semibold tabular-nums text-[hsl(var(--ink))]">{fmt(today[key])}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="space-y-2">
        <SectionLabel>Last {range} days</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STATS_METRICS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={metric === key}
              onClick={() => onMetric(key)}
              className={cn(
                "rounded-[10px] border bg-[hsl(var(--surface))] p-3 text-left transition-colors",
                metric === key
                  ? "border-[hsl(var(--accent-fill))] ring-1 ring-[hsl(var(--accent-fill))]"
                  : "border-[hsl(var(--border))] hover:border-[hsl(var(--border-strong))]",
              )}
            >
              <span className="block text-xs text-[hsl(var(--ink-muted))]">{label}</span>
              <span className="block text-2xl font-semibold tabular-nums text-[hsl(var(--ink))]">{fmt(totals[key])}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-[hsl(var(--ink-faint))]">Pick a total to chart it.</p>
      </div>

      <div className="space-y-2">
        <SectionLabel>Funnel</SectionLabel>
        <ol className="space-y-2 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
          {steps.map((step, i) => {
            const width = totals.visit > 0 ? Math.max(step.value > 0 ? 2 : 0, Math.min(100, (step.value / totals.visit) * 100)) : 0;
            return (
              <li key={step.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-[hsl(var(--ink))]">{step.label}</span>
                  <span className="tabular-nums text-[hsl(var(--ink))]">
                    {fmt(step.value)}
                    {i > 0 && (
                      <span className="ml-2 text-xs text-[hsl(var(--ink-muted))]">{formatPct(step.pctOfPrevious)} of previous</span>
                    )}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[hsl(var(--sunken))]">
                  <div className="h-full rounded-full bg-[hsl(var(--accent-fill))]" style={{ width: `${width}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
        <p className="text-xs text-[hsl(var(--ink-faint))]">Independent daily totals, not the same people — a step can pass 100%.</p>
      </div>

      <div className="space-y-2">
        <SectionLabel>{STATS_METRICS.find((m) => m.key === metric)?.label} per day</SectionLabel>
        {empty ? (
          <div className="rounded-[10px] border border-dashed border-[hsl(var(--border-strong))] px-6 py-10 text-center">
            <BarChart3 className="mx-auto mb-2 h-5 w-5 text-[hsl(var(--ink-faint))]" />
            <p className="text-sm font-medium text-[hsl(var(--ink-muted))]">Nothing counted in the last {range} days yet</p>
          </div>
        ) : (
          <DailyChart days={days} metric={metric} todayDate={todayDate} />
        )}
      </div>

      <div className="space-y-2">
        <SectionLabel>Daily numbers</SectionLabel>
        <div className="overflow-x-auto rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
          <table className="w-full min-w-[560px] text-sm tabular-nums">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] text-left text-xs text-[hsl(var(--ink-muted))]">
                <th scope="col" className="sticky left-0 bg-[hsl(var(--surface))] px-3 py-2 font-medium">
                  Day
                </th>
                {STATS_METRICS.map(({ key, short }) => (
                  <th key={key} scope="col" className="px-2 py-2 text-right font-medium">
                    {short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => {
                const isToday = d.date === todayDate;
                return (
                  <tr
                    key={d.date}
                    className={cn(
                      "border-b border-[hsl(var(--border))] last:border-0",
                      isToday && "bg-[hsl(var(--caution-tint))]",
                    )}
                  >
                    <th
                      scope="row"
                      className={cn(
                        "sticky left-0 whitespace-nowrap px-3 py-1.5 text-left font-normal text-[hsl(var(--ink))]",
                        isToday ? "bg-[hsl(var(--caution-tint))] font-medium text-[hsl(var(--caution-text))]" : "bg-[hsl(var(--surface))]",
                      )}
                    >
                      {isToday ? "Today" : formatStatsDate(d.date)}
                    </th>
                    {STATS_METRICS.map(({ key }) => (
                      <td
                        key={key}
                        className={cn("px-2 py-1.5 text-right", d[key] === 0 ? "text-[hsl(var(--ink-faint))]" : "text-[hsl(var(--ink))]")}
                      >
                        {fmt(d[key])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** One series, so no legend: the label above names it. CSS bars (no chart library); hover or
 * focus a bar to read its day; today (still filling up) is the solid bar. */
function DailyChart({ days, metric, todayDate }: { days: StatsDay[]; metric: StatsMetric; todayDate: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(...days.map((d) => d[metric])));
  const shown = active ?? days.length - 1;
  const shownDay = days[shown]!;
  const label = STATS_METRICS.find((m) => m.key === metric)?.label.toLowerCase() ?? "";
  const gap = days.length > 45 ? "gap-px" : "gap-[2px]";

  return (
    <div className="rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
      <p className="mb-3 text-sm text-[hsl(var(--ink-muted))]" aria-live="polite">
        <span className="font-medium text-[hsl(var(--ink))]">
          {shownDay.date === todayDate ? "Today" : `${formatStatsWeekday(shownDay.date)} ${formatStatsDate(shownDay.date)}`}
        </span>{" "}
        · <span className="tabular-nums text-[hsl(var(--ink))]">{fmt(shownDay[metric])}</span> {label}
      </p>
      <div className="flex gap-2">
        <div className="flex h-36 flex-col justify-between text-right text-[10px] tabular-nums text-[hsl(var(--ink-faint))]">
          <span>{fmt(max)}</span>
          <span>{fmt(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative h-36 min-w-0 flex-1">
          <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            <div className="border-t border-dashed border-[hsl(var(--border))]" />
            <div className="border-t border-dashed border-[hsl(var(--border))]" />
            <div className="border-t border-[hsl(var(--border-strong))]" />
          </div>
          <div className={cn("relative flex h-full items-end", gap)} onMouseLeave={() => setActive(null)}>
            {days.map((d, i) => {
              const value = d[metric];
              const pct = (value / max) * 100;
              const isToday = d.date === todayDate;
              return (
                <button
                  key={d.date}
                  type="button"
                  aria-label={`${isToday ? "Today" : formatStatsDate(d.date)}: ${fmt(value)} ${label}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="group flex h-full min-w-0 flex-1 items-end focus-visible:outline-none"
                >
                  <span
                    className={cn(
                      "block w-full rounded-t-[3px] transition-colors",
                      isToday ? "bg-[hsl(var(--accent-fill))]" : "bg-[hsl(var(--accent-fill)/0.55)]",
                      value === 0 ? "opacity-0" : active === null || active === i ? "opacity-100" : "opacity-60",
                      "group-focus-visible:ring-2 group-focus-visible:ring-[hsl(var(--ring))]",
                    )}
                    style={{ height: `${Math.max(pct, value > 0 ? 2 : 0)}%` }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pl-8 text-[10px] text-[hsl(var(--ink-faint))]">
        <span>{formatStatsDate(days[0]!.date)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}
