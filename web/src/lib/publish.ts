// Publish dialog logic (cloud mode, Phase 2 — contract: shared/public.ts). Pure, so it's
// unit-tested directly: which links get a live preview, the "m:ss" video offset, the handle
// rule, and the exact PublishRequest the dialog sends.

import {
  Handle,
  MAX_TAGS,
  PublishRequest,
  type PublicRecipe,
  type PublicVisibility,
  type SourceInput,
} from "@recipe/shared";

export type SourceKind = "video" | "own" | "other";

/** What the link looks like before asking the API. Credit itself always comes from the API. */
export interface DetectedVideo {
  platform: "youtube" | "tiktok" | "other";
  /** YouTube/TikTok id when it can be read from the link (the API is the authority). */
  videoId: string | null;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function parseUrl(raw: string): URL | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url;
  } catch {
    return null;
  }
}

/** A full http(s) URL for the API (adds https:// when the creator pasted "youtu.be/…"). */
export function normalizeUrl(raw: string): string | null {
  const url = parseUrl(raw);
  return url ? url.toString() : null;
}

/** Recognizes YouTube and TikTok links (and says "other" for any other valid web link). */
export function detectVideo(raw: string): DetectedVideo | null {
  const url = parseUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return { platform: "youtube", videoId: YOUTUBE_ID.test(id) ? id : null };
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && YOUTUBE_ID.test(v)) return { platform: "youtube", videoId: v };
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && ["shorts", "embed", "live", "v"].includes(parts[0]) && YOUTUBE_ID.test(parts[1])) {
      return { platform: "youtube", videoId: parts[1] };
    }
    return { platform: "youtube", videoId: null };
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const m = /\/video\/(\d+)/.exec(url.pathname);
    return { platform: "tiktok", videoId: m ? m[1] : null };
  }
  return { platform: "other", videoId: null };
}

/** Whether the dialog should call GET /sources/preview for this link (YouTube/TikTok only —
 * other sites have no oEmbed credit, the creator types the name). */
export function shouldPreview(raw: string): boolean {
  const d = detectVideo(raw);
  return d !== null && d.platform !== "other";
}

/** "1:23" → 83, "1:02:03" → 3723, "45" → 45, "" → 0. null when it isn't a time. */
export function parseOffset(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0;
  if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return null;
  const parts = t.split(":").map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  const seconds = parts.reduce((acc, p) => acc * 60 + p, 0);
  return seconds <= 24 * 3600 ? seconds : null;
}

/** 83 → "1:23", 3723 → "1:02:03". */
export function formatOffset(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Lowercases and drops a leading "@" as people type it. */
export function normalizeHandle(text: string): string {
  return text.trim().replace(/^@+/, "").toLowerCase();
}

/** null when fine; otherwise a short, friendly reason (shown inline under the field). */
export function handleProblem(text: string): string | null {
  const h = normalizeHandle(text);
  if (h.length === 0) return "Pick a handle — it's shown as “Transcribed by @you”.";
  if (h.length < 3) return "At least 3 characters.";
  if (h.length > 20) return "At most 20 characters.";
  if (!Handle.safeParse(h).success) return "Only lowercase letters, numbers, and _.";
  return null;
}

export interface PublishForm {
  sourceKind: SourceKind;
  videoUrl: string;
  /** Typed credit for video links outside YouTube/TikTok. */
  videoCreditName: string;
  offsetText: string;
  otherUrl: string;
  otherName: string;
  visibility: PublicVisibility;
  tags: string[];
  /** Only sent on the first publish (the account has no handle yet). */
  handle: string;
  needsHandle: boolean;
}

export const EMPTY_FORM: PublishForm = {
  sourceKind: "video",
  videoUrl: "",
  videoCreditName: "",
  offsetText: "0:00",
  otherUrl: "",
  otherName: "",
  visibility: "public",
  tags: [],
  handle: "",
  needsHandle: false,
};

/** The form for re-opening the dialog on a published recipe (or "Update public version"). */
export function formFromSnapshot(pub: PublicRecipe, needsHandle = false): PublishForm {
  const s = pub.source;
  const base = { ...EMPTY_FORM, visibility: pub.visibility, tags: [...pub.tags], needsHandle };
  if (s.kind === "own") return { ...base, sourceKind: "own" };
  if (s.kind === "other") return { ...base, sourceKind: "other", otherUrl: s.url ?? "", otherName: s.channelName ?? "" };
  return {
    ...base,
    sourceKind: "video",
    videoUrl: s.url ?? "",
    videoCreditName: s.platform === "other" ? s.channelName ?? "" : "",
    offsetText: formatOffset(s.startOffsetSeconds),
  };
}

export function toggleTag(tags: readonly string[], tag: string): string[] {
  if (tags.includes(tag)) return tags.filter((t) => t !== tag);
  if (tags.length >= MAX_TAGS) return [...tags];
  return [...tags, tag];
}

export type BuildResult = { ok: true; request: PublishRequest } | { ok: false; error: string };

/** Validates the dialog and builds the request body (validated against the shared schema). */
export function buildPublishRequest(form: PublishForm): BuildResult {
  let source: SourceInput;
  if (form.sourceKind === "own") {
    source = { kind: "own" };
  } else if (form.sourceKind === "video") {
    const url = normalizeUrl(form.videoUrl);
    if (!url) return { ok: false, error: "Paste the link to the video." };
    const offset = parseOffset(form.offsetText);
    if (offset === null) return { ok: false, error: "Write the start time as m:ss, e.g. 1:30." };
    const platform = detectVideo(url)?.platform ?? "other";
    const creditName = form.videoCreditName.trim();
    if (platform === "other" && !creditName) return { ok: false, error: "Add the creator's name for this video." };
    source = {
      kind: "video",
      url,
      creditName: platform === "other" ? creditName.slice(0, 100) : null,
      startOffsetSeconds: offset,
    };
  } else {
    const url = normalizeUrl(form.otherUrl);
    if (!url) return { ok: false, error: "Add a link to where the recipe is from." };
    const creditName = form.otherName.trim();
    if (!creditName) return { ok: false, error: "Add the name of the person or site to credit." };
    source = { kind: "other", url, creditName: creditName.slice(0, 100) };
  }

  let handle: string | null = null;
  if (form.needsHandle) {
    const problem = handleProblem(form.handle);
    if (problem) return { ok: false, error: problem };
    handle = normalizeHandle(form.handle);
  }

  const parsed = PublishRequest.safeParse({
    visibility: form.visibility,
    source,
    tags: form.tags.slice(0, MAX_TAGS),
    handle,
  });
  if (!parsed.success) return { ok: false, error: "Some details don't look right — check the link and tags." };
  return { ok: true, request: parsed.data };
}

/** "Update public version": same settings as the live snapshot, the private latest recipe. */
export function updateRequestFromSnapshot(pub: PublicRecipe): PublishRequest {
  const result = buildPublishRequest(formFromSnapshot(pub));
  if (result.ok) return result.request;
  // A snapshot always has valid settings; fall back to the raw shape if it somehow doesn't.
  return { visibility: pub.visibility, source: { kind: "own" }, tags: pub.tags, handle: null };
}

/** The private recipe has edits that aren't public yet. */
export function hasUnpublishedChanges(privateVersion: number | null | undefined, pub: Pick<PublicRecipe, "sourceVersion"> | null): boolean {
  return pub !== null && typeof privateVersion === "number" && privateVersion > pub.sourceVersion;
}

export const TAG_GROUP_LABELS: Record<string, string> = { cuisine: "Cuisine", meal: "Meal", diet: "Diet" };

/** "middle-eastern" → "Middle Eastern", "gluten-free" → "Gluten-free", "other-cuisine" → "Other". */
export function tagLabel(tag: string): string {
  if (tag === "other-cuisine") return "Other";
  const hyphenated = tag === "gluten-free" || tag === "dairy-free" || tag === "high-protein";
  const text = hyphenated ? tag : tag.replace(/-/g, " ");
  return text.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Review status, explained to the owner
// ---------------------------------------------------------------------------

/** What the API stores as reviewReason when the automatic check couldn't run (api/src/publish.ts). */
export const SCREENING_UNAVAILABLE_REASON = "screening unavailable";

export type ReviewNotice =
  /** Screening held it with a reason; the owner can fix the source and re-publish. */
  | { kind: "flagged"; reason: string }
  /** The automatic check couldn't run; a moderator will look. */
  | { kind: "unavailable" }
  /** Held, but the snapshot predates reviewReason (or has none). */
  | { kind: "waiting" }
  /** Hidden by a moderator. */
  | { kind: "hidden" };

/** null when the recipe is live. */
export function reviewNotice(pub: Pick<PublicRecipe, "status" | "reviewReason">): ReviewNotice | null {
  if (pub.status === "hidden") return { kind: "hidden" };
  if (pub.status !== "review") return null;
  const reason = (pub.reviewReason ?? "").trim();
  if (!reason) return { kind: "waiting" };
  if (reason.toLowerCase() === SCREENING_UNAVAILABLE_REASON) return { kind: "unavailable" };
  return { kind: "flagged", reason };
}

// ---------------------------------------------------------------------------
// Publish-dialog suggestions (POST /recipes/:id/publish/suggestions)
// ---------------------------------------------------------------------------

/**
 * The sourceUrl to ask suggestions for, given the form and the video preview — or undefined
 * when we shouldn't ask yet (a YouTube/TikTok link whose preview hasn't resolved, or no link).
 * "My own recipe" asks with null.
 */
export function suggestionSourceUrl(
  form: Pick<PublishForm, "sourceKind" | "videoUrl" | "otherUrl">,
  previewUrl: string | null,
): string | null | undefined {
  if (form.sourceKind === "own") return null;
  if (form.sourceKind === "other") return normalizeUrl(form.otherUrl);
  // A video: YouTube/TikTok wait for the preview (its canonical URL); other sites use the link.
  if (shouldPreview(form.videoUrl)) return previewUrl ?? undefined;
  return normalizeUrl(form.videoUrl) ?? undefined;
}

/** A stable cache key for one suggestions request ("" for null). */
export const suggestionKey = (sourceUrl: string | null) => sourceUrl ?? "";

/** "Use suggested": adds every suggested tag not already picked, up to MAX_TAGS. Never removes. */
export function applySuggestedTags(current: readonly string[], suggested: readonly string[]): string[] {
  const out = [...current];
  for (const tag of suggested) {
    if (out.length >= MAX_TAGS) break;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * Tags to pre-select when suggestions arrive: only on a first publish, and only while the user
 * hasn't touched the tags (then a newer suggestion may replace the earlier pre-selection).
 * Returns null to leave the tags alone.
 */
export function autoSelectedTags(opts: {
  firstPublish: boolean;
  userTouchedTags: boolean;
  suggested: readonly string[];
}): string[] | null {
  if (!opts.firstPublish || opts.userTouchedTags || opts.suggested.length === 0) return null;
  return opts.suggested.slice(0, MAX_TAGS);
}

export interface SuggestionsLoader<T> {
  /**
   * Asks for suggestions for this source (one request per distinct URL — repeats reuse it).
   * Resolves with the response only if this is still the latest URL asked about when it
   * arrives; null when it's stale or the request failed (failures are ignored).
   */
  load(sourceUrl: string | null): Promise<T | null>;
}

export function createSuggestionsLoader<T>(fetchSuggestions: (sourceUrl: string | null) => Promise<T>): SuggestionsLoader<T> {
  const cache = new Map<string, Promise<T | null>>();
  let latest: string | null = null;
  return {
    async load(sourceUrl) {
      const key = suggestionKey(sourceUrl);
      latest = key;
      let pending = cache.get(key);
      if (!pending) {
        pending = fetchSuggestions(sourceUrl).catch(() => null);
        cache.set(key, pending);
      }
      const res = await pending;
      return latest === key ? res : null;
    },
  };
}
