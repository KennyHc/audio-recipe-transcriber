import { describe, expect, it } from "vitest";
import {
  INITIAL_MINI_PLAYER,
  miniPlayerReducer,
  slotInView,
  type MiniPlayerEvent,
  type MiniPlayerState,
} from "./miniPlayer";

const run = (events: MiniPlayerEvent[], from: MiniPlayerState = INITIAL_MINI_PLAYER) =>
  events.reduce(miniPlayerReducer, from);

const out: MiniPlayerEvent = { type: "visibility", inView: false };
const back: MiniPlayerEvent = { type: "visibility", inView: true };
const play: MiniPlayerEvent = { type: "playing", playing: true };
const pause: MiniPlayerEvent = { type: "playing", playing: false };

describe("mini player: docked ↔ floating", () => {
  it("starts docked", () => {
    expect(INITIAL_MINI_PLAYER.mode).toBe("docked");
  });

  it("floats when scrolled out of view while playing", () => {
    expect(run([play, out]).mode).toBe("floating");
  });

  it("stays docked when scrolled out of view while not playing", () => {
    expect(run([out]).mode).toBe("docked");
    expect(run([play, pause, out]).mode).toBe("docked");
  });

  it("floats when playback starts while out of view", () => {
    expect(run([out, play]).mode).toBe("floating");
  });

  it("a timestamp clicked out of view floats it (no scroll needed), even before it plays", () => {
    expect(run([out, { type: "seek" }]).mode).toBe("floating");
  });

  it("a timestamp clicked in view leaves it docked", () => {
    expect(run([{ type: "seek" }]).mode).toBe("docked");
  });

  it("pausing or the video ending keeps the mini player", () => {
    expect(run([play, out, pause]).mode).toBe("floating");
  });

  it("scrolling back into view re-docks", () => {
    expect(run([play, out, back]).mode).toBe("docked");
    // …and floats again on the way out while still playing.
    expect(run([play, out, back, out]).mode).toBe("floating");
  });

  it("× closes it: docked and not playing; scrolling around doesn't bring it back", () => {
    const closed = run([play, out, { type: "close" }]);
    expect(closed).toMatchObject({ mode: "docked", playing: false, slotInView: false });
    expect(run([back, out], closed).mode).toBe("docked");
    // Playing again from somewhere (e.g. a timestamp) out of view floats it again.
    expect(run([{ type: "seek" }], closed).mode).toBe("floating");
    expect(run([play], closed).mode).toBe("floating");
  });

  it("cook mode covering the page docks it", () => {
    expect(run([play, out, { type: "covered" }])).toMatchObject({ mode: "docked", playing: false });
  });

  it("repeated identical events don't change state", () => {
    const s = run([play, out]);
    expect(miniPlayerReducer(s, out)).toBe(s);
    expect(miniPlayerReducer(s, play)).toBe(s);
  });
});

describe("slotInView", () => {
  it("needs a real share of the slot on screen", () => {
    expect(slotInView({ isIntersecting: false, intersectionRatio: 0 })).toBe(false);
    expect(slotInView({ isIntersecting: true, intersectionRatio: 0.1 })).toBe(false);
    expect(slotInView({ isIntersecting: true, intersectionRatio: 0.35 })).toBe(true);
    expect(slotInView({ isIntersecting: true, intersectionRatio: 1 })).toBe(true);
  });
});
