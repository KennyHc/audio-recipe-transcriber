// A small reducer for cook-mode's multiple concurrent timers. Timers are driven by
// wall-clock timestamps (Date.now()), not by counting ticks, so they stay accurate even
// when the tab is throttled/backgrounded — a "tick" action just re-derives state from now().

export type TimerStatus = "running" | "paused" | "finished";

export interface TimerState {
  id: string;
  label: string;
  durationMs: number;
  /** When running: the timestamp (Date.now()) at which the timer completes. Null otherwise. */
  endAt: number | null;
  /** When paused: how much time was left. Null otherwise. */
  remainingMsAtPause: number | null;
  status: TimerStatus;
}

export type TimersState = TimerState[];

export type TimerAction =
  | { type: "start"; id: string; label: string; durationMs: number; now: number }
  | { type: "pause"; id: string; now: number }
  | { type: "resume"; id: string; now: number }
  | { type: "cancel"; id: string }
  | { type: "tick"; now: number }
  | { type: "finish"; id: string; now: number }
  | { type: "dismiss"; id: string };

export function timersReducer(state: TimersState, action: TimerAction): TimersState {
  switch (action.type) {
    case "start":
      return [
        ...state,
        {
          id: action.id,
          label: action.label,
          durationMs: action.durationMs,
          endAt: action.now + action.durationMs,
          remainingMsAtPause: null,
          status: "running",
        },
      ];

    case "pause":
      return state.map((t) =>
        t.id === action.id && t.status === "running"
          ? {
              ...t,
              status: "paused",
              remainingMsAtPause: Math.max(0, (t.endAt ?? action.now) - action.now),
              endAt: null,
            }
          : t,
      );

    case "resume":
      return state.map((t) =>
        t.id === action.id && t.status === "paused"
          ? {
              ...t,
              status: "running",
              endAt: action.now + (t.remainingMsAtPause ?? 0),
              remainingMsAtPause: null,
            }
          : t,
      );

    case "cancel":
    case "dismiss":
      return state.filter((t) => t.id !== action.id);

    case "finish":
      return state.map((t) =>
        t.id === action.id
          ? { ...t, status: "finished", endAt: action.now, remainingMsAtPause: 0 }
          : t,
      );

    case "tick":
      return state.map((t) => {
        if (t.status === "running" && t.endAt !== null && t.endAt <= action.now) {
          return { ...t, status: "finished", endAt: action.now, remainingMsAtPause: 0 };
        }
        return t;
      });

    default:
      return state;
  }
}

/** Milliseconds remaining on a timer at a given moment (0 once finished). */
export function remainingMs(timer: TimerState, now: number): number {
  if (timer.status === "paused") return timer.remainingMsAtPause ?? 0;
  if (timer.status === "finished") return 0;
  if (timer.endAt === null) return 0;
  return Math.max(0, timer.endAt - now);
}

/** Format milliseconds as mm:ss. */
export function formatMs(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** True if any timer is currently running or paused (i.e. would be lost on exit). */
export function hasActiveTimers(state: TimersState): boolean {
  return state.some((t) => t.status === "running" || t.status === "paused");
}
