import { beforeEach, describe, expect, it } from "vitest";
import {
  dismissShareFirst,
  isShareFirstDismissed,
  markReadyNoteSeen,
  shareFirstTarget,
  showReadyNote,
  wasReadyNoteSeen,
} from "./nudges";

const job = (id: string, status: "done" | "error" | "transcribing", createdAt: string) => ({ id, status, createdAt });

describe("shareFirstTarget (Library: “Share your first recipe in the bank”)", () => {
  const jobs = [
    job("old", "done", "2026-10-01T10:00:00Z"),
    job("newest-done", "done", "2026-10-05T10:00:00Z"),
    job("running", "transcribing", "2026-10-09T10:00:00Z"),
    job("failed", "error", "2026-10-08T10:00:00Z"),
  ];
  const base = { jobs, publishedCount: 0, publishedLoaded: true, dismissed: false };

  it("shows with ≥1 finished recipe and nothing published, targeting the most recent finished one", () => {
    expect(shareFirstTarget(base)).toBe("newest-done");
  });

  it("hides once anything is published (in any status)", () => {
    expect(shareFirstTarget({ ...base, publishedCount: 1 })).toBeNull();
  });

  it("hides until we know what's published (no flash on load), and when dismissed", () => {
    expect(shareFirstTarget({ ...base, publishedLoaded: false })).toBeNull();
    expect(shareFirstTarget({ ...base, dismissed: true })).toBeNull();
  });

  it("hides with no finished recipe", () => {
    expect(shareFirstTarget({ ...base, jobs: [job("a", "transcribing", "2026-10-01T00:00:00Z")] })).toBeNull();
    expect(shareFirstTarget({ ...base, jobs: [] })).toBeNull();
    expect(shareFirstTarget({ ...base, jobs: null })).toBeNull();
  });
});

describe("showReadyNote (recipe page: “Recipe ready — share it in the bank?”)", () => {
  it("only right after it finished, while unpublished, and once per recipe", () => {
    expect(showReadyNote({ justFinished: true, published: false, seen: false })).toBe(true);
    expect(showReadyNote({ justFinished: false, published: false, seen: false })).toBe(false);
    expect(showReadyNote({ justFinished: true, published: true, seen: false })).toBe(false);
    expect(showReadyNote({ justFinished: true, published: undefined, seen: false })).toBe(false); // still loading
    expect(showReadyNote({ justFinished: true, published: false, seen: true })).toBe(false);
  });
});

describe("nudge memory (localStorage)", () => {
  beforeEach(() => {
    try {
      localStorage.removeItem("recipe-transcriber:nudges");
    } catch {
      /* no storage in this environment — the in-memory fallback is used */
    }
  });

  it("remembers the dismissed card and which recipes' notes were seen", () => {
    expect(isShareFirstDismissed()).toBe(false);
    dismissShareFirst();
    expect(isShareFirstDismissed()).toBe(true);

    expect(wasReadyNoteSeen("r1")).toBe(false);
    markReadyNoteSeen("r1");
    markReadyNoteSeen("r1");
    expect(wasReadyNoteSeen("r1")).toBe(true);
    expect(wasReadyNoteSeen("r2")).toBe(false);
    expect(isShareFirstDismissed()).toBe(true); // independent keys
  });
});
