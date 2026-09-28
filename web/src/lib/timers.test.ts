import { describe, it, expect } from "vitest";
import { timersReducer, remainingMs, formatMs, hasActiveTimers, type TimersState } from "./timers";

describe("timersReducer", () => {
  it("starts a running timer with the given duration", () => {
    const state = timersReducer([], { type: "start", id: "a", label: "Simmer", durationMs: 60_000, now: 1000 });
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ id: "a", status: "running", endAt: 61_000 });
  });

  it("pauses a running timer, freezing the remaining time", () => {
    let state: TimersState = timersReducer([], {
      type: "start",
      id: "a",
      label: "Simmer",
      durationMs: 60_000,
      now: 0,
    });
    state = timersReducer(state, { type: "pause", id: "a", now: 20_000 });
    expect(state[0].status).toBe("paused");
    expect(state[0].remainingMsAtPause).toBe(40_000);
    expect(state[0].endAt).toBeNull();
  });

  it("resumes a paused timer from the frozen remaining time", () => {
    let state: TimersState = timersReducer([], {
      type: "start",
      id: "a",
      label: "Simmer",
      durationMs: 60_000,
      now: 0,
    });
    state = timersReducer(state, { type: "pause", id: "a", now: 20_000 });
    state = timersReducer(state, { type: "resume", id: "a", now: 25_000 });
    expect(state[0].status).toBe("running");
    expect(state[0].endAt).toBe(65_000); // 25_000 + 40_000 remaining
  });

  it("cancel removes the timer", () => {
    let state: TimersState = timersReducer([], {
      type: "start",
      id: "a",
      label: "Simmer",
      durationMs: 60_000,
      now: 0,
    });
    state = timersReducer(state, { type: "cancel", id: "a" });
    expect(state).toHaveLength(0);
  });

  it("dismiss removes the timer", () => {
    let state: TimersState = timersReducer([], {
      type: "start",
      id: "a",
      label: "Simmer",
      durationMs: 60_000,
      now: 0,
    });
    state = timersReducer(state, { type: "finish", id: "a", now: 60_000 });
    state = timersReducer(state, { type: "dismiss", id: "a" });
    expect(state).toHaveLength(0);
  });

  it("tick finishes a timer whose endAt has passed", () => {
    let state: TimersState = timersReducer([], {
      type: "start",
      id: "a",
      label: "Simmer",
      durationMs: 10_000,
      now: 0,
    });
    state = timersReducer(state, { type: "tick", now: 5_000 });
    expect(state[0].status).toBe("running");
    state = timersReducer(state, { type: "tick", now: 10_001 });
    expect(state[0].status).toBe("finished");
  });

  it("does not tick-finish a paused timer", () => {
    let state: TimersState = timersReducer([], {
      type: "start",
      id: "a",
      label: "Simmer",
      durationMs: 10_000,
      now: 0,
    });
    state = timersReducer(state, { type: "pause", id: "a", now: 5_000 });
    state = timersReducer(state, { type: "tick", now: 999_999 });
    expect(state[0].status).toBe("paused");
  });

  it("multiple timers can run independently", () => {
    let state: TimersState = [];
    state = timersReducer(state, { type: "start", id: "a", label: "A", durationMs: 10_000, now: 0 });
    state = timersReducer(state, { type: "start", id: "b", label: "B", durationMs: 20_000, now: 0 });
    state = timersReducer(state, { type: "pause", id: "a", now: 1000 });
    expect(state.find((t) => t.id === "a")?.status).toBe("paused");
    expect(state.find((t) => t.id === "b")?.status).toBe("running");
  });
});

describe("remainingMs", () => {
  it("computes remaining time for a running timer", () => {
    const timer = { id: "a", label: "A", durationMs: 10_000, endAt: 10_000, remainingMsAtPause: null, status: "running" as const };
    expect(remainingMs(timer, 4000)).toBe(6000);
  });

  it("returns frozen remaining time for a paused timer", () => {
    const timer = { id: "a", label: "A", durationMs: 10_000, endAt: null, remainingMsAtPause: 3000, status: "paused" as const };
    expect(remainingMs(timer, 999_999)).toBe(3000);
  });

  it("returns 0 for a finished timer", () => {
    const timer = { id: "a", label: "A", durationMs: 10_000, endAt: 10_000, remainingMsAtPause: 0, status: "finished" as const };
    expect(remainingMs(timer, 20_000)).toBe(0);
  });
});

describe("formatMs", () => {
  it("formats as mm:ss", () => {
    expect(formatMs(60_000)).toBe("1:00");
    expect(formatMs(9_000)).toBe("0:09");
    expect(formatMs(0)).toBe("0:00");
  });
});

describe("hasActiveTimers", () => {
  it("is true when a timer is running or paused, false when finished/empty", () => {
    expect(hasActiveTimers([])).toBe(false);
    expect(
      hasActiveTimers([{ id: "a", label: "A", durationMs: 1, endAt: 1, remainingMsAtPause: null, status: "running" }]),
    ).toBe(true);
    expect(
      hasActiveTimers([{ id: "a", label: "A", durationMs: 1, endAt: 1, remainingMsAtPause: 0, status: "finished" }]),
    ).toBe(false);
  });
});
