import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Recipe } from "@recipe/shared";
import { ChefHat, ChevronLeft, ChevronRight, Clock, Pause, Play, Thermometer, Timer as TimerIcon, X } from "lucide-react";
import { convertQuantity, convertTemperatureText, type UnitSystem } from "@/lib/units";
import { formatDuration, formatQuantity, formatUnit } from "@/lib/format";
import { ingredientsForStep, stepAudioRange } from "@/lib/cook";
import { timersReducer, hasActiveTimers, type TimersState } from "@/lib/timers";
import { StatusPill } from "@/components/StatusPill";
import { IngredientChips } from "@/components/cook/IngredientChips";
import { TimerTray } from "@/components/cook/TimerTray";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Plays a short, gentle two-note chime with the Web Audio API — no audio files. */
function playChime() {
  try {
    const AudioCtxCtor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxCtor) return;
    const ctx = new AudioCtxCtor();
    const now = ctx.currentTime;
    [0, 0.22].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 0 ? 880 : 1108.73;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch {
    /* Web Audio unsupported or blocked; fail silently */
  }
}

/** Imperative handle so a parent (JobPage) can trigger the exit-confirmation dialog
 * from outside — used when the browser back button navigates away from /cook while
 * timers are running, so the parent can restore the hash and ask cook mode to confirm
 * rather than silently unmounting it and losing the timers. */
export interface CookModeHandle {
  requestCloseWithConfirm: () => void;
}

export interface CookModeProps {
  recipe: Recipe;
  unitSystem: UnitSystem;
  scaleFactor: number;
  checkedIngredients: Set<number>;
  onToggleIngredient: (index: number) => void;
  audioRef: RefObject<HTMLAudioElement | null>;
  onClose: () => void;
  /** Called whenever the running/paused-ness of the timer tray changes, so the parent
   * can decide whether a stray browser-back navigation needs to be intercepted. */
  onActiveTimersChange?: (active: boolean) => void;
}

export const CookMode = forwardRef<CookModeHandle, CookModeProps>(function CookMode(
  { recipe, unitSystem, scaleFactor, checkedIngredients, onToggleIngredient, audioRef, onClose, onActiveTimersChange },
  ref,
) {
  const totalSlides = recipe.steps.length + 2; // ingredients + steps + end
  const [slideIndex, setSlideIndex] = useState(0);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [hearingStep, setHearingStep] = useState<number | null>(null);

  const [timers, dispatchTimer] = useReducer(timersReducer, [] as TimersState);
  const [now, setNow] = useState(() => Date.now());
  const chimedRef = useRef<Set<string>>(new Set());

  const goNext = useCallback(() => setSlideIndex((i) => Math.min(totalSlides - 1, i + 1)), [totalSlides]);
  const goPrev = useCallback(() => setSlideIndex((i) => Math.max(0, i - 1)), []);

  const requestClose = useCallback(() => {
    if (hasActiveTimers(timers)) {
      setConfirmExitOpen(true);
    } else {
      onClose();
    }
  }, [timers, onClose]);

  useImperativeHandle(ref, () => ({
    requestCloseWithConfirm: () => setConfirmExitOpen(true),
  }));

  // Let the parent know whether timers are running/paused, so it can intercept a
  // browser-back navigation instead of unmounting us and silently losing them.
  useEffect(() => {
    onActiveTimersChange?.(hasActiveTimers(timers));
  }, [timers, onActiveTimersChange]);

  // Wake Lock: keep the screen on while cook mode is open; re-acquire when the tab
  // becomes visible again (the OS releases it when the tab is hidden).
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> } };
    if (!nav.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        sentinel = (await nav.wakeLock!.request("screen")) ?? null;
        if (cancelled) {
          sentinel?.release().catch(() => {});
          return;
        }
        setWakeLockActive(true);
        sentinel?.addEventListener("release", () => setWakeLockActive(false));
      } catch {
        setWakeLockActive(false);
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible" && sentinel === null) acquire();
    }

    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      sentinel?.release().catch(() => {});
      setWakeLockActive(false);
    };
  }, []);

  // Keyboard: Esc closes, ←/→ and Space navigate.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (confirmExitOpen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      } else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmExitOpen, requestClose, goNext, goPrev]);

  // Timer ticking, driven by Date.now() so it stays accurate under throttling.
  useEffect(() => {
    if (!timers.some((t) => t.status === "running")) return;
    const interval = setInterval(() => {
      const n = Date.now();
      setNow(n);
      dispatchTimer({ type: "tick", now: n });
    }, 250);
    return () => clearInterval(interval);
  }, [timers]);

  // Chime once per timer the moment it finishes.
  useEffect(() => {
    for (const t of timers) {
      if (t.status === "finished" && !chimedRef.current.has(t.id)) {
        chimedRef.current.add(t.id);
        playChime();
      }
    }
  }, [timers]);

  function startTimer(stepIndex: number, label: string, durationMinutes: number) {
    dispatchTimer({
      type: "start",
      id: `${stepIndex}-${Date.now()}`,
      label,
      durationMs: durationMinutes * 60_000,
      now: Date.now(),
    });
  }

  // "Hear this step": play from this step's timestamp to the next step's (or the end).
  useEffect(() => {
    const el = audioRef.current;
    if (!el || hearingStep === null) return;
    const duration = Number.isFinite(el.duration) ? el.duration : Infinity;
    const range = stepAudioRange(recipe.steps, hearingStep, duration);
    if (!range) {
      setHearingStep(null);
      return;
    }
    el.currentTime = range.start;
    el.play().catch(() => {
      /* autoplay may be blocked */
    });
    function onTime() {
      if (el!.currentTime >= range!.end - 0.05) el!.pause();
    }
    function onPause() {
      setHearingStep(null);
    }
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("pause", onPause);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hearingStep]);

  // Swipe navigation (touch only); ignored if the gesture looks vertical.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) {
      if (dx < 0) goNext();
      else goPrev();
    }
  }

  const isIngredientsSlide = slideIndex === 0;
  const isEndSlide = slideIndex === totalSlides - 1;
  const stepIndex = slideIndex - 1; // valid when neither of the above

  const matchedForStep = useMemo(() => {
    if (isIngredientsSlide || isEndSlide) return [];
    return ingredientsForStep(recipe.steps[stepIndex]?.text ?? "", recipe.ingredients);
  }, [isIngredientsSlide, isEndSlide, stepIndex, recipe.steps, recipe.ingredients]);

  const progress = totalSlides > 1 ? slideIndex / (totalSlides - 1) : 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[hsl(var(--background))]">
      <div className="h-1 w-full bg-[hsl(var(--sunken))]">
        <div
          className="h-full bg-[hsl(var(--accent-fill))] transition-[width] duration-200 ease-out"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="flex items-center justify-between px-4 sm:px-8 py-3">
        <span className="text-xs text-[hsl(var(--ink-faint))]">{wakeLockActive ? "Screen stays on" : ""}</span>
        <button
          type="button"
          onClick={requestClose}
          aria-label="Exit cook mode"
          className="flex h-9 w-9 items-center justify-center rounded-full text-[hsl(var(--ink-muted))] transition-colors hover:bg-[hsl(var(--accent-tint))] hover:text-[hsl(var(--ink))]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-8" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div key={slideIndex} className="mx-auto max-w-[640px] animate-in fade-in-0 duration-200 py-4 sm:py-10">
          {isIngredientsSlide && (
            <IngredientsSlide
              recipe={recipe}
              unitSystem={unitSystem}
              scaleFactor={scaleFactor}
              checked={checkedIngredients}
              onToggle={onToggleIngredient}
            />
          )}

          {!isIngredientsSlide && !isEndSlide && (
            <StepSlide
              step={recipe.steps[stepIndex]}
              stepNumber={stepIndex + 1}
              totalSteps={recipe.steps.length}
              unitSystem={unitSystem}
              scaleFactor={scaleFactor}
              warnings={recipe.warnings.filter((w) => w.target === `steps[${stepIndex}]`)}
              matches={matchedForStep}
              checked={checkedIngredients}
              onToggleIngredient={onToggleIngredient}
              isHearingThis={hearingStep === stepIndex}
              onToggleHear={() => setHearingStep((cur) => (cur === stepIndex ? null : stepIndex))}
              onStartTimer={() =>
                startTimer(stepIndex, recipe.steps[stepIndex].text.slice(0, 60), recipe.steps[stepIndex].durationMinutes!)
              }
            />
          )}

          {isEndSlide && <EndSlide onDone={requestClose} />}
        </div>
      </div>

      <TimerTray
        timers={timers}
        now={now}
        onPause={(id) => dispatchTimer({ type: "pause", id, now: Date.now() })}
        onResume={(id) => dispatchTimer({ type: "resume", id, now: Date.now() })}
        onCancel={(id) => dispatchTimer({ type: "cancel", id })}
        onDismiss={(id) => dispatchTimer({ type: "dismiss", id })}
      />

      <div className="flex items-center justify-between gap-3 border-t border-[hsl(var(--border))] px-4 sm:px-8 py-4">
        <Button variant="outline" size="lg" onClick={goPrev} disabled={slideIndex === 0}>
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        <span className="hidden sm:block text-xs text-[hsl(var(--ink-faint))] tabular-nums">
          {isIngredientsSlide ? "Ingredients" : isEndSlide ? "Done" : `Step ${stepIndex + 1} of ${recipe.steps.length}`}
        </span>
        <Button size="lg" onClick={goNext} disabled={slideIndex === totalSlides - 1}>
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={confirmExitOpen} onOpenChange={setConfirmExitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exit cook mode?</DialogTitle>
            <DialogDescription>
              {timers.filter((t) => t.status === "running" || t.status === "paused").length === 1
                ? "Your running timer will stop and can't be recovered."
                : "Your running timers will stop and can't be recovered."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Keep cooking</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmExitOpen(false);
                onClose();
              }}
            >
              Exit anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

function IngredientsSlide({
  recipe,
  unitSystem,
  scaleFactor,
  checked,
  onToggle,
}: {
  recipe: Recipe;
  unitSystem: UnitSystem;
  scaleFactor: number;
  checked: Set<number>;
  onToggle: (index: number) => void;
}) {
  return (
    <div className="space-y-5">
      <h2 className="font-serif text-[34px] sm:text-[44px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
        Gather your ingredients
      </h2>
      <ul className="space-y-1">
        {recipe.ingredients.map((ing, i) => {
          const scaledQty = ing.quantity !== null ? ing.quantity * scaleFactor : null;
          const converted = convertQuantity(scaledQty, ing.unit, unitSystem);
          const qtyLabel = formatQuantity(converted.quantity);
          const unitLabel = formatUnit(converted.unit, converted.quantity);
          const isChecked = checked.has(i);
          return (
            <li key={i} className="flex items-start gap-3 rounded-md px-2 py-2.5">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggle(i)}
                className="mt-1.5 h-5 w-5 shrink-0 rounded-[4px] accent-[hsl(var(--accent-fill))]"
                aria-label={`Mark ${ing.item} as done`}
              />
              <label
                className={cn(
                  "block flex-1 cursor-pointer text-base sm:text-lg",
                  isChecked && "line-through text-[hsl(var(--ink-faint))]",
                )}
                onClick={() => onToggle(i)}
              >
                {qtyLabel && <span className="font-semibold tabular-nums">{qtyLabel} </span>}
                {unitLabel && <span className="font-semibold">{unitLabel} </span>}
                <span>{ing.item}</span>
                {ing.prep && <span className="text-[hsl(var(--ink-muted))]">, {ing.prep}</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StepSlide({
  step,
  stepNumber,
  totalSteps,
  unitSystem,
  scaleFactor,
  warnings,
  matches,
  checked,
  onToggleIngredient,
  isHearingThis,
  onToggleHear,
  onStartTimer,
}: {
  step: Recipe["steps"][number];
  stepNumber: number;
  totalSteps: number;
  unitSystem: UnitSystem;
  scaleFactor: number;
  warnings: Recipe["warnings"];
  matches: ReturnType<typeof ingredientsForStep>;
  checked: Set<number>;
  onToggleIngredient: (index: number) => void;
  isHearingThis: boolean;
  onToggleHear: () => void;
  onStartTimer: () => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-[hsl(var(--ink-muted))]">
        Step {stepNumber} of {totalSteps}
      </p>

      <IngredientChips matches={matches} unitSystem={unitSystem} scaleFactor={scaleFactor} checked={checked} onToggle={onToggleIngredient} />

      <div>
        <div className="font-serif text-[48px] sm:text-[64px] leading-none text-[hsl(var(--accent-text))]">{stepNumber}</div>
        <p className="mt-3 max-w-[32ch] text-[22px] sm:text-[34px] leading-[1.35] text-[hsl(var(--ink))]">
          {convertTemperatureText(step.text, unitSystem)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {step.durationMinutes !== null && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--sunken))] px-2.5 py-1 text-sm font-medium text-[hsl(var(--ink-muted))]">
            <Clock className="h-3.5 w-3.5" />
            {formatDuration(step.durationMinutes)}
          </span>
        )}
        {step.temperature && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--sunken))] px-2.5 py-1 text-sm font-medium text-[hsl(var(--ink-muted))]">
            <Thermometer className="h-3.5 w-3.5" />
            {convertTemperatureText(step.temperature, unitSystem)}
          </span>
        )}
        <StatusPill warnings={warnings} />
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {step.timestamp !== null && (
          <Button variant="outline" onClick={onToggleHear}>
            {isHearingThis ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isHearingThis ? "Stop" : "Hear this step"}
          </Button>
        )}
      </div>

      {step.durationMinutes !== null && (
        <Button size="lg" onClick={onStartTimer} className="w-full sm:w-auto">
          <TimerIcon className="h-4 w-4" />
          Start {formatDuration(step.durationMinutes)} timer
        </Button>
      )}
    </div>
  );
}

function EndSlide({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex flex-col items-center gap-5 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--accent-tint))] text-[hsl(var(--accent-text))]">
        <ChefHat className="h-7 w-7" />
      </span>
      <h2 className="font-serif text-[34px] sm:text-[44px] leading-[1.05] tracking-[-0.01em] text-[hsl(var(--ink))]">
        Enjoy your meal
      </h2>
      <Button size="lg" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
