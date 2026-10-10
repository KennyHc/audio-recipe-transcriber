// Public recipe pages: when the embedded YouTube player floats as a mini player. Pure, so it's
// unit-tested directly; components/public/YouTubePlayer.tsx feeds it events.
//
// The player element never moves in the DOM (moving an iframe reloads it). It sits in an
// in-flow slot that always keeps its 16:9 height, and only its CSS switches between "docked"
// (filling the slot) and "floating" (position: fixed in a corner). So "in view" is always
// measured on the slot, never on the floating element.
//
// Rules:
//   - Scrolling the slot out of view while the video plays → floating.
//   - A timestamp clicked while the slot is out of view → floating (and it seeks + plays),
//     without scrolling the page.
//   - Pausing or the video ending keeps the mini player where it is (the user paused it there).
//   - × closes it: the component pauses the video and it re-docks.
//   - Scrolling the slot back into view always re-docks.

export type MiniPlayerMode = "docked" | "floating";

export interface MiniPlayerState {
  /** The in-flow slot is (mostly) on screen. */
  slotInView: boolean;
  playing: boolean;
  mode: MiniPlayerMode;
}

export type MiniPlayerEvent =
  | { type: "visibility"; inView: boolean }
  | { type: "playing"; playing: boolean }
  /** A recipe timestamp was clicked (the player will seek and play). */
  | { type: "seek" }
  /** The mini player's × (the component also pauses the video). */
  | { type: "close" }
  /** The page is covered (e.g. cook mode opened); the component pauses the video. */
  | { type: "covered" };

export const INITIAL_MINI_PLAYER: MiniPlayerState = { slotInView: true, playing: false, mode: "docked" };

export function miniPlayerReducer(state: MiniPlayerState, event: MiniPlayerEvent): MiniPlayerState {
  switch (event.type) {
    case "visibility": {
      if (event.inView === state.slotInView) return state;
      if (event.inView) return { ...state, slotInView: true, mode: "docked" };
      return { ...state, slotInView: false, mode: state.playing ? "floating" : state.mode };
    }
    case "playing": {
      if (event.playing === state.playing) return state;
      const mode = event.playing && !state.slotInView ? "floating" : state.mode;
      return { ...state, playing: event.playing, mode };
    }
    case "seek":
      return state.slotInView ? state : { ...state, mode: "floating" };
    case "close":
    case "covered":
      return { ...state, playing: false, mode: "docked" };
  }
}

/** The slot counts as "in view" when at least this share of it is visible below the top bar. */
export const SLOT_VISIBLE_RATIO = 0.35;

export function slotInView(entry: { isIntersecting: boolean; intersectionRatio: number }): boolean {
  return entry.isIntersecting && entry.intersectionRatio >= SLOT_VISIBLE_RATIO;
}
