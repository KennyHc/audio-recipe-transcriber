import { describe, expect, it, vi } from "vitest";
import { MAX_TAGS, PublishRequest, type PublicRecipe } from "@recipe/shared";
import {
  EMPTY_FORM,
  applySuggestedTags,
  autoSelectedTags,
  buildPublishRequest,
  createSuggestionsLoader,
  reviewNotice,
  suggestionSourceUrl,
  detectVideo,
  formFromSnapshot,
  formatOffset,
  handleProblem,
  hasUnpublishedChanges,
  normalizeHandle,
  normalizeUrl,
  parseOffset,
  shouldPreview,
  tagLabel,
  toggleTag,
  updateRequestFromSnapshot,
  type PublishForm,
} from "./publish";
import { recipe } from "@/backend/cloud/testFixtures";

describe("source link parsing (which links get a live preview)", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "youtube", "dQw4w9WgXcQ"],
    ["youtu.be/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/@somechannel", "youtube", null],
    ["https://www.tiktok.com/@cook/video/7234567890123456789", "tiktok", "7234567890123456789"],
    ["https://vm.tiktok.com/ZMabc123/", "tiktok", null],
    ["https://vimeo.com/12345", "other", null],
  ] as const)("%s → %s", (url, platform, videoId) => {
    expect(detectVideo(url)).toEqual({ platform, videoId });
  });

  it("previews only YouTube/TikTok links, not other sites or junk", () => {
    expect(shouldPreview("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(shouldPreview("https://www.tiktok.com/@a/video/1")).toBe(true);
    expect(shouldPreview("https://example.com/recipe")).toBe(false);
    expect(shouldPreview("not a link")).toBe(false);
    expect(shouldPreview("")).toBe(false);
    expect(shouldPreview("javascript:alert(1)")).toBe(false);
  });

  it("normalizes a pasted link without a scheme", () => {
    expect(normalizeUrl("youtu.be/dQw4w9WgXcQ")).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(normalizeUrl("  ")).toBeNull();
    expect(normalizeUrl("ftp://x.com/a")).toBeNull();
  });
});

describe("video start offset (m:ss)", () => {
  it.each([
    ["0:00", 0],
    ["", 0],
    ["45", 45],
    ["1:30", 90],
    ["12:05", 725],
    ["1:02:03", 3723],
    [" 2:00 ", 120],
  ])("%j → %d", (text, seconds) => {
    expect(parseOffset(text)).toBe(seconds);
  });

  it.each(["1:60", "abc", "1:2:3:4", "-5", "1.5", "25:00:00"])("rejects %j", (text) => {
    expect(parseOffset(text)).toBeNull();
  });

  it("formats back", () => {
    expect(formatOffset(0)).toBe("0:00");
    expect(formatOffset(90)).toBe("1:30");
    expect(formatOffset(3723)).toBe("1:02:03");
  });
});

describe("handle validation", () => {
  it("normalizes @ and case", () => {
    expect(normalizeHandle(" @Kenny_1 ")).toBe("kenny_1");
  });
  it.each([
    ["kenny", null],
    ["@kenny", null],
    ["", /Pick a handle/],
    ["ab", /At least 3/],
    ["a".repeat(21), /At most 20/],
    ["ken-ny", /lowercase letters, numbers, and _/],
    ["ken ny", /lowercase letters/],
  ] as const)("%j", (text, expected) => {
    const problem = handleProblem(text);
    if (expected === null) expect(problem).toBeNull();
    else expect(problem).toMatch(expected);
  });
});

describe("tags", () => {
  it("toggles and caps at MAX_TAGS", () => {
    let tags: string[] = [];
    for (const t of ["chinese", "dinner", "vegan", "snack", "korean", "sauce", "thai"]) tags = toggleTag(tags, t);
    expect(tags).toHaveLength(MAX_TAGS);
    expect(tags).not.toContain("thai");
    expect(toggleTag(tags, "dinner")).not.toContain("dinner");
  });
  it("labels", () => {
    expect(tagLabel("middle-eastern")).toBe("Middle Eastern");
    expect(tagLabel("gluten-free")).toBe("Gluten-free");
    expect(tagLabel("other-cuisine")).toBe("Other");
  });
});

const videoForm = (patch: Partial<PublishForm> = {}): PublishForm => ({
  ...EMPTY_FORM,
  sourceKind: "video",
  videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  offsetText: "1:30",
  tags: ["chinese", "dinner"],
  ...patch,
});

describe("buildPublishRequest (payload shape)", () => {
  it("a YouTube video: credit comes from the API, so no creditName; offset in seconds", () => {
    const r = buildPublishRequest(videoForm());
    expect(r).toEqual({
      ok: true,
      request: {
        visibility: "public",
        source: { kind: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", creditName: null, startOffsetSeconds: 90 },
        tags: ["chinese", "dinner"],
        handle: null,
      },
    });
    if (r.ok) expect(PublishRequest.safeParse(r.request).success).toBe(true);
  });

  it("other video sites need the creator's name", () => {
    expect(buildPublishRequest(videoForm({ videoUrl: "https://vimeo.com/1" }))).toMatchObject({ ok: false });
    const r = buildPublishRequest(videoForm({ videoUrl: "https://vimeo.com/1", videoCreditName: " Chef Lee " }));
    expect(r.ok && r.request.source).toEqual({ kind: "video", url: "https://vimeo.com/1", creditName: "Chef Lee", startOffsetSeconds: 90 });
  });

  it("own and other sources", () => {
    const own = buildPublishRequest({ ...EMPTY_FORM, sourceKind: "own", visibility: "unlisted" });
    expect(own.ok && own.request).toEqual({ visibility: "unlisted", source: { kind: "own" }, tags: [], handle: null });
    const other = buildPublishRequest({ ...EMPTY_FORM, sourceKind: "other", otherUrl: "example.com/r", otherName: "Grandma" });
    expect(other.ok && other.request.source).toEqual({ kind: "other", url: "https://example.com/r", creditName: "Grandma" });
    expect(buildPublishRequest({ ...EMPTY_FORM, sourceKind: "other", otherUrl: "example.com/r" }).ok).toBe(false);
  });

  it("sends the handle only on the first publish, and validates it", () => {
    expect(buildPublishRequest(videoForm({ needsHandle: true, handle: "x" }))).toMatchObject({ ok: false });
    const first = buildPublishRequest(videoForm({ needsHandle: true, handle: "@Kenny" }));
    expect(first.ok && first.request.handle).toBe("kenny");
    const later = buildPublishRequest(videoForm({ needsHandle: false, handle: "kenny" }));
    expect(later.ok && later.request.handle).toBeNull();
  });

  it("rejects a bad offset or a missing link", () => {
    expect(buildPublishRequest(videoForm({ offsetText: "1:75" }))).toMatchObject({ ok: false, error: /m:ss/ });
    expect(buildPublishRequest(videoForm({ videoUrl: "" }))).toMatchObject({ ok: false });
  });
});

function snapshot(patch: Partial<PublicRecipe> = {}): PublicRecipe {
  return {
    id: "r1",
    ownerId: "alice",
    handle: "alice",
    visibility: "public",
    status: "live",
    recipe: recipe("Noodles"),
    sourceVersion: 2,
    source: {
      kind: "video",
      platform: "youtube",
      videoId: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Noodles",
      channelName: "Chef",
      channelUrl: null,
      thumbnailUrl: null,
      startOffsetSeconds: 75,
    },
    tags: ["chinese"],
    terms: ["noodles"],
    stats: { likes: 0, saves: 0, score: 0 },
    publishedAt: "2026-10-09T10:00:00.000Z",
    updatedAt: "2026-10-09T10:00:00.000Z",
    ...patch,
  };
}

describe("Update public version", () => {
  it("re-sends the snapshot's settings", () => {
    expect(updateRequestFromSnapshot(snapshot())).toEqual({
      visibility: "public",
      source: { kind: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", creditName: null, startOffsetSeconds: 75 },
      tags: ["chinese"],
      handle: null,
    });
    const own = snapshot({ source: { ...snapshot().source, kind: "own", platform: null, url: null, channelName: null } });
    expect(updateRequestFromSnapshot(own).source).toEqual({ kind: "own" });
  });

  it("prefills the dialog from the snapshot", () => {
    expect(formFromSnapshot(snapshot())).toMatchObject({ sourceKind: "video", offsetText: "1:15", tags: ["chinese"] });
  });

  it("is enabled only when the private recipe is newer", () => {
    expect(hasUnpublishedChanges(3, snapshot())).toBe(true);
    expect(hasUnpublishedChanges(2, snapshot())).toBe(false);
    expect(hasUnpublishedChanges(null, snapshot())).toBe(false);
    expect(hasUnpublishedChanges(3, null)).toBe(false);
  });
});

describe("reviewNotice (why a published recipe isn't live)", () => {
  it("live → nothing to explain", () => {
    expect(reviewNotice(snapshot())).toBeNull();
  });
  it("review with a reason → flagged, with the reason", () => {
    expect(reviewNotice(snapshot({ status: "review", reviewReason: "  The video looks unrelated.  " }))).toEqual({
      kind: "flagged",
      reason: "The video looks unrelated.",
    });
  });
  it("screening unavailable → a moderator will look", () => {
    expect(reviewNotice(snapshot({ status: "review", reviewReason: "screening unavailable" }))).toEqual({ kind: "unavailable" });
    expect(reviewNotice(snapshot({ status: "review", reviewReason: "Screening Unavailable" }))).toEqual({ kind: "unavailable" });
  });
  it("old snapshots (no reviewReason) and null/empty → generic waiting", () => {
    const old = snapshot({ status: "review" });
    delete (old as Partial<PublicRecipe>).reviewReason;
    expect(reviewNotice(old)).toEqual({ kind: "waiting" });
    expect(reviewNotice(snapshot({ status: "review", reviewReason: null }))).toEqual({ kind: "waiting" });
    expect(reviewNotice(snapshot({ status: "review", reviewReason: " " }))).toEqual({ kind: "waiting" });
  });
  it("hidden → hidden by a moderator (whatever the reason)", () => {
    expect(reviewNotice(snapshot({ status: "hidden", reviewReason: "x" }))).toEqual({ kind: "hidden" });
  });
});

describe("publish suggestions", () => {
  const yt = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  it("suggestionSourceUrl: own → null; YouTube waits for the preview; other links ask directly", () => {
    expect(suggestionSourceUrl({ ...EMPTY_FORM, sourceKind: "own" }, null)).toBeNull();
    expect(suggestionSourceUrl({ ...EMPTY_FORM, videoUrl: yt }, null)).toBeUndefined();
    expect(suggestionSourceUrl({ ...EMPTY_FORM, videoUrl: yt }, yt)).toBe(yt);
    expect(suggestionSourceUrl({ ...EMPTY_FORM, videoUrl: "" }, null)).toBeUndefined();
    expect(suggestionSourceUrl({ ...EMPTY_FORM, videoUrl: "vimeo.com/123" }, null)).toBe("https://vimeo.com/123");
    expect(suggestionSourceUrl({ ...EMPTY_FORM, sourceKind: "other", otherUrl: "example.com/r" }, null)).toBe(
      "https://example.com/r",
    );
    expect(suggestionSourceUrl({ ...EMPTY_FORM, sourceKind: "other", otherUrl: "" }, null)).toBeNull();
  });

  it("applySuggestedTags adds, never removes, and stops at MAX_TAGS", () => {
    expect(applySuggestedTags(["vegan"], ["thai", "vegan", "dinner"])).toEqual(["vegan", "thai", "dinner"]);
    const five = ["chinese", "dinner", "lunch", "vegan", "side"];
    expect(applySuggestedTags(five, ["thai", "snack"])).toEqual([...five, "thai"]);
    expect(applySuggestedTags(five, ["thai", "snack"])).toHaveLength(MAX_TAGS);
  });

  it("autoSelectedTags pre-selects only on a first publish the user hasn't touched", () => {
    expect(autoSelectedTags({ firstPublish: true, userTouchedTags: false, suggested: ["thai", "dinner"] })).toEqual([
      "thai",
      "dinner",
    ]);
    expect(autoSelectedTags({ firstPublish: false, userTouchedTags: false, suggested: ["thai"] })).toBeNull();
    expect(autoSelectedTags({ firstPublish: true, userTouchedTags: true, suggested: ["thai"] })).toBeNull();
    expect(autoSelectedTags({ firstPublish: true, userTouchedTags: false, suggested: [] })).toBeNull();
  });

  it("loader: one request per distinct URL", async () => {
    const fetch = vi.fn(async (url: string | null) => ({ tags: [url ?? "own"], creditWarning: null }));
    const loader = createSuggestionsLoader(fetch);
    await loader.load(yt);
    await loader.load(null);
    await loader.load(yt);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([yt, null]);
  });

  it("loader: a stale response (the link changed meanwhile) resolves null", async () => {
    let release!: (v: { tags: string[]; creditWarning: string | null }) => void;
    const fetch = vi.fn((url: string | null) =>
      url === "https://a.test/"
        ? new Promise<{ tags: string[]; creditWarning: string | null }>((r) => (release = r))
        : Promise.resolve({ tags: ["thai"], creditWarning: "Wrong video?" }),
    );
    const loader = createSuggestionsLoader(fetch);
    const first = loader.load("https://a.test/");
    const second = loader.load("https://b.test/");
    release({ tags: ["indian"], creditWarning: null });
    expect(await first).toBeNull();
    expect(await second).toEqual({ tags: ["thai"], creditWarning: "Wrong video?" });
  });

  it("loader: failures are ignored (null), and not retried for the same URL", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("rate_limited");
    });
    const loader = createSuggestionsLoader(fetch);
    expect(await loader.load(yt)).toBeNull();
    expect(await loader.load(yt)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
