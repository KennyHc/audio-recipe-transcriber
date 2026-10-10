import { describe, expect, it } from "vitest";
import { CreateRecipeRequest } from "@recipe/shared";
import { MAX_SOURCE_URL_LENGTH, displaySourceUrl, parseSourceUrl, sourceUrlProblem } from "./sourceUrl";

describe("parseSourceUrl (the optional video link at upload / on the recipe page)", () => {
  it("an empty field is fine and sends nothing", () => {
    expect(parseSourceUrl("")).toEqual({ ok: true, url: null });
    expect(parseSourceUrl("   ")).toEqual({ ok: true, url: null });
  });

  it("accepts YouTube, TikTok and any http(s) link; adds https:// when it's missing", () => {
    expect(parseSourceUrl("https://www.youtube.com/watch?v=qH__o17xHls")).toEqual({
      ok: true,
      url: "https://www.youtube.com/watch?v=qH__o17xHls",
    });
    expect(parseSourceUrl("youtu.be/qH__o17xHls")).toEqual({ ok: true, url: "https://youtu.be/qH__o17xHls" });
    expect(parseSourceUrl(" https://www.tiktok.com/@cook/video/7234567890123456789 ")).toEqual({
      ok: true,
      url: "https://www.tiktok.com/@cook/video/7234567890123456789",
    });
    expect(parseSourceUrl("http://example.com/recipe").ok).toBe(true);
  });

  it("rejects things that aren't web links, with an inline message", () => {
    for (const bad of ["not a link", "ftp://example.com/x", "javascript:alert(1)", "localhost", "https://"]) {
      const r = parseSourceUrl(bad);
      expect(r.ok, bad).toBe(false);
      expect(sourceUrlProblem(bad)).toMatch(/web link/);
    }
  });

  it("enforces the 500-character cap (contract + Firestore rules)", () => {
    const long = `https://example.com/${"a".repeat(MAX_SOURCE_URL_LENGTH)}`;
    expect(parseSourceUrl(long)).toEqual({ ok: false, error: expect.stringMatching(/too long/) });
  });

  it("whatever it accepts passes the CreateRecipeRequest contract", () => {
    for (const raw of ["youtu.be/qH__o17xHls", "https://www.tiktok.com/@cook/video/1", "example.com/a?b=c#d"]) {
      const r = parseSourceUrl(raw);
      if (!r.ok || !r.url) throw new Error(raw);
      expect(r.url).toMatch(/^https?:\/\/.+/); // firestore.rules
      const body = { id: "abcdefgh", fileName: "a.mp3", transcript: { language: "en", segments: [] }, sourceUrl: r.url };
      expect(CreateRecipeRequest.safeParse(body).success, raw).toBe(true);
    }
  });
});

describe("displaySourceUrl", () => {
  it("drops the scheme and www, and shortens long links", () => {
    expect(displaySourceUrl("https://www.youtube.com/watch?v=qH__o17xHls")).toBe("youtube.com/watch?v=qH__o17xHls");
    expect(displaySourceUrl("https://example.com/")).toBe("example.com");
    const shown = displaySourceUrl(`https://example.com/${"a".repeat(100)}`, 30);
    expect(shown).toHaveLength(30);
    expect(shown.endsWith("…")).toBe(true);
  });
});
