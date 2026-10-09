import { describe, expect, it, vi } from "vitest";
import { friendlyCloudMessage, friendlyFirestoreMessage, nextMonthStart, CloudApiError } from "./errors";
import { createApiClient } from "./api";
import { cloudRecipe, transcript, usage, versioned } from "./testFixtures";

const NOW = new Date("2026-10-08T12:00:00.000Z");

describe("friendlyCloudMessage", () => {
  it("quota_exceeded names the limit and the reset date", () => {
    const msg = friendlyCloudMessage("quota_exceeded", { limit: 30, now: NOW });
    expect(msg).toMatch(/^You've used your 30 free recipes this month\. They reset on /);
    expect(msg).toContain(new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(nextMonthStart(NOW)));
  });

  it("quota_exceeded uses retryAfterSeconds for the date when given", () => {
    const msg = friendlyCloudMessage("quota_exceeded", { retryAfterSeconds: 3 * 86400, now: NOW });
    const expected = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(new Date("2026-10-11T12:00:00Z"));
    expect(msg).toContain(expected);
  });

  it.each([
    ["budget_exhausted", /daily limit for everyone/],
    ["unauthenticated", /sign-in has expired/],
    ["app_check_failed", /couldn't verify this browser/],
    ["not_found", /^Recipe not found\.$/],
    ["too_large", /40,000 characters/],
    ["network", /Couldn't reach/],
    ["internal", /on our side/],
  ] as const)("%s → friendly text", (code, pattern) => {
    expect(friendlyCloudMessage(code)).toMatch(pattern);
  });

  it("bad_request/conflict show the API's own (safe) message", () => {
    expect(friendlyCloudMessage("conflict", { serverMessage: "No saved transcript." })).toBe("No saved transcript.");
  });

  it("maps Firestore permission-denied (missing or foreign recipe) to not found", () => {
    expect(friendlyFirestoreMessage({ code: "permission-denied" })).toBe("Recipe not found.");
    expect(friendlyFirestoreMessage({ code: "unavailable" })).toMatch(/offline/);
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createApiClient", () => {
  function client(fetchImpl: typeof fetch) {
    return createApiClient({
      baseUrl: "https://api.example.test/",
      getIdToken: vi.fn(async (force?: boolean) => (force ? "fresh-id-token" : "id-token")),
      getAppCheckToken: async () => "app-check-token",
      knownLimit: () => 30,
      fetch: fetchImpl,
    });
  }

  it("sends both auth headers and validates the response", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { recipe: cloudRecipe("job-12345678", "Pasta", "2026-10-08T00:00:00Z"), version: versioned(1, "Pasta"), usage }),
    );
    const res = await client(fetchMock as unknown as typeof fetch).createRecipe({ id: "job-12345678", fileName: "a.mp3", transcript });
    expect(res.recipe.title).toBe("Pasta");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/recipes");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer id-token", "X-Firebase-AppCheck": "app-check-token" });
    expect(JSON.parse(init.body as string)).toMatchObject({ id: "job-12345678", fileName: "a.mp3" });
  });

  it("turns a CloudError body into a CloudApiError with a friendly message", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(429, { error: "Monthly quota reached", code: "quota_exceeded", retryAfterSeconds: 86400 }),
    );
    const err = await client(fetchMock as unknown as typeof fetch).getMe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudApiError);
    expect((err as CloudApiError).code).toBe("quota_exceeded");
    expect((err as CloudApiError).status).toBe(429);
    expect((err as CloudApiError).message).toMatch(/You've used your 30 free recipes this month/);
  });

  it("network failures and unreadable bodies get their own codes", async () => {
    const offline = client((async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch);
    await expect(offline.getMe()).rejects.toMatchObject({ code: "network" });

    const html = client((async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch);
    await expect(html.getMe()).rejects.toMatchObject({ code: "internal" });

    const wrongShape = client((async () => jsonResponse(200, { nope: true })) as unknown as typeof fetch);
    await expect(wrongShape.getMe()).rejects.toMatchObject({ code: "bad_response" });
  });

  it("DELETE /me can force a fresh ID token (after reauthentication)", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    await client(fetchMock as unknown as typeof fetch).deleteMe({ forceRefreshToken: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/me");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toMatchObject({ Authorization: "Bearer fresh-id-token" });
  });
});
