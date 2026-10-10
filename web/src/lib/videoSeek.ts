// Public recipe pages: what a recipe timestamp does. Timestamps are seconds into the creator's
// uploaded clip; the clip may start part-way into the original video (source.startOffsetSeconds),
// so the original's moment is offset + t. With an embedded YouTube player we seek it; without one
// (embedding disabled) we open youtu.be/{id}?t=… in a new tab; other sources have no timeline.

import type { RecipeSource } from "@recipe/shared";

export function videoSeconds(source: Pick<RecipeSource, "startOffsetSeconds">, t: number): number {
  return Math.max(0, Math.floor(source.startOffsetSeconds + Math.max(0, t)));
}

export function youtubeWatchUrl(videoId: string, seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return `https://youtu.be/${encodeURIComponent(videoId)}${t > 0 ? `?t=${t}` : ""}`;
}

export function isYouTube(source: RecipeSource): source is RecipeSource & { videoId: string } {
  return source.kind === "video" && source.platform === "youtube" && !!source.videoId;
}

export type TimestampAction = { kind: "seek"; seconds: number } | { kind: "open"; url: string } | null;

/** null = timestamps aren't useful for this source (hide them). */
export function timestampAction(source: RecipeSource, t: number, playerAvailable: boolean): TimestampAction {
  if (!isYouTube(source)) return null;
  const seconds = videoSeconds(source, t);
  return playerAvailable ? { kind: "seek", seconds } : { kind: "open", url: youtubeWatchUrl(source.videoId, seconds) };
}

/** Whether recipe timestamps should show at all on this public page. */
export function timestampsUseful(source: RecipeSource): boolean {
  return isYouTube(source);
}
