import { describe, expect, it } from "vitest";
import type { RecipeSource } from "@recipe/shared";
import { timestampAction, timestampsUseful, videoSeconds, youtubeWatchUrl } from "./videoSeek";

const yt: RecipeSource = {
  kind: "video",
  platform: "youtube",
  videoId: "dQw4w9WgXcQ",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: null,
  channelName: "Chef",
  channelUrl: null,
  thumbnailUrl: null,
  startOffsetSeconds: 95,
};

describe("timestamp → video moment", () => {
  it("adds the clip's start offset", () => {
    expect(videoSeconds(yt, 0)).toBe(95);
    expect(videoSeconds(yt, 12.7)).toBe(107);
    expect(videoSeconds({ startOffsetSeconds: 0 }, 42)).toBe(42);
  });

  it("seeks the embedded player when there is one", () => {
    expect(timestampAction(yt, 30, true)).toEqual({ kind: "seek", seconds: 125 });
  });

  it("opens youtu.be/{id}?t=… without a player", () => {
    expect(timestampAction(yt, 30, false)).toEqual({ kind: "open", url: "https://youtu.be/dQw4w9WgXcQ?t=125" });
    expect(youtubeWatchUrl("abc", 0)).toBe("https://youtu.be/abc");
  });

  it("hides timestamps for sources without a seekable video", () => {
    const tiktok: RecipeSource = { ...yt, platform: "tiktok", videoId: "123" };
    const own: RecipeSource = { ...yt, kind: "own", platform: null, videoId: null, url: null };
    expect(timestampAction(tiktok, 10, true)).toBeNull();
    expect(timestampAction(own, 10, true)).toBeNull();
    expect(timestampsUseful(yt)).toBe(true);
    expect(timestampsUseful(tiktok)).toBe(false);
  });
});
