// Phase 2: error mapping for the new codes and the public-bank API routes (API mocked).
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api";
import { CloudApiError, friendlyCloudMessage } from "./errors";
import { buildReportRequest } from "@/lib/report";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function client(fetchImpl: unknown, signedIn = true) {
  return createApiClient({
    baseUrl: "https://api.example.test",
    getIdToken: vi.fn(async () => (signedIn ? "id-token" : null)),
    isSignedIn: () => signedIn,
    getAppCheckToken: async () => "app-check-token",
    fetch: fetchImpl as typeof fetch,
  });
}

describe("Phase 2 error messages", () => {
  it.each([
    ["handle_taken", "That handle is taken — try another."],
    ["duplicate_video", "This video already has a recipe in the bank."],
    ["source_unavailable", "We couldn't find that video — is it public?"],
    ["forbidden", "You don't have permission to do that."],
    ["rate_limited", "You've done that a lot today. Try again tomorrow."],
  ] as const)("%s", (code, text) => {
    expect(friendlyCloudMessage(code)).toBe(text);
  });

  it("rate_limited uses retryAfterSeconds", () => {
    expect(friendlyCloudMessage("rate_limited", { retryAfterSeconds: 3 * 3600 })).toMatch(/in 3 hours/);
    expect(friendlyCloudMessage("rate_limited", { retryAfterSeconds: 120 })).toMatch(/in 2 minutes/);
  });

  it("duplicate_video carries existingPublicId", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(409, { error: "dup", code: "duplicate_video", retryAfterSeconds: null, existingPublicId: "pub-1" }),
    );
    const err = await client(fetchMock)
      .publish("r1", { visibility: "public", source: { kind: "own" }, tags: [], handle: null })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudApiError);
    expect(err).toMatchObject({ code: "duplicate_video", existingPublicId: "pub-1", message: "This video already has a recipe in the bank." });
  });
});

describe("public bank routes", () => {
  const preview = {
    platform: "youtube",
    videoId: "dQw4w9WgXcQ",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "T",
    channelName: "C",
    channelUrl: null,
    thumbnailUrl: null,
    existingPublicId: null,
  };

  it("GET /sources/preview encodes the URL", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, preview));
    const res = await client(fetchMock).previewSource("https://youtu.be/x?a=1&b=2");
    expect(res.channelName).toBe("C");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://api.example.test/sources/preview?url=https%3A%2F%2Fyoutu.be%2Fx%3Fa%3D1%26b%3D2",
    );
  });

  it("POST /recipes/:id/publish/suggestions sends the source URL and validates the response", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { tags: ["chinese", "dinner"], creditWarning: "This video is “Egg Fried Rice” — is that the right link?" }),
    );
    const res = await client(fetchMock).publishSuggestions("r 1", { sourceUrl: "https://youtu.be/dQw4w9WgXcQ" });
    expect(res).toEqual({ tags: ["chinese", "dinner"], creditWarning: "This video is “Egg Fried Rice” — is that the right link?" });
    const [url, init] = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
    expect(url).toBe("https://api.example.test/recipes/r%201/publish/suggestions");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ sourceUrl: "https://youtu.be/dQw4w9WgXcQ" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer id-token");
  });

  it("suggestions: unknown tags in the response are rejected as a bad response", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { tags: ["pizza-party"], creditWarning: null }));
    const err = await client(fetchMock).publishSuggestions("r1", { sourceUrl: null }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "bad_response" });
  });

  it("like/save use POST to set and DELETE to clear", async () => {
    const body = { stats: { likes: 1, saves: 0, score: 1 }, liked: true, saved: false };
    const fetchMock = vi.fn(async () => jsonResponse(200, body));
    const api = client(fetchMock);
    await api.setLike("p1", true);
    await api.setSave("p1", false);
    await api.unpublish("r1");
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect([calls[0][1].method, calls[0][0]]).toEqual(["POST", "https://api.example.test/public/p1/like"]);
    expect([calls[1][1].method, calls[1][0]]).toEqual(["DELETE", "https://api.example.test/public/p1/save"]);
    expect([calls[2][1].method, calls[2][0]]).toEqual(["DELETE", "https://api.example.test/recipes/r1/publish"]);
  });

  it("reports work signed out: App Check only, no Authorization header", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    await client(fetchMock, false).report("p1", { kind: "report", reason: "spam", contact: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/public/p1/report");
    expect(init.headers).toEqual({ "X-Firebase-AppCheck": "app-check-token", "Content-Type": "application/json" });
  });

  it("signed-out calls to signed-in routes fail before the request", async () => {
    const fetchMock = vi.fn();
    await expect(client(fetchMock, false).setLike("p1", true)).rejects.toThrow("Sign in to continue.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("admin action posts the body", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    await client(fetchMock).adminAction("p1", { action: "hide", reportId: "rep1", note: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/admin/public/p1");
    expect(JSON.parse(init.body as string)).toEqual({ action: "hide", reportId: "rep1", note: null });
  });
});

describe("buildReportRequest", () => {
  it("claims need an email; reports don't", () => {
    expect(buildReportRequest("claim", "Please remove", "")).toMatchObject({ ok: false });
    expect(buildReportRequest("claim", "Please remove", "me@x.com")).toEqual({
      ok: true,
      body: { kind: "claim", reason: "Please remove", contact: "me@x.com" },
    });
    expect(buildReportRequest("report", " spam ", "")).toEqual({ ok: true, body: { kind: "report", reason: "spam", contact: null } });
    expect(buildReportRequest("report", "", "")).toMatchObject({ ok: false });
    expect(buildReportRequest("report", "x", "not-an-email")).toMatchObject({ ok: false, error: /email/ });
  });
});
