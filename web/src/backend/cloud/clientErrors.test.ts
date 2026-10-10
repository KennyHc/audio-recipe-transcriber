// Error reporting through the API client: POST /client-errors, and which failures get reported.
import { describe, expect, it, vi } from "vitest";
import { APP_CHECK_HEADER, type ClientErrorReport } from "@recipe/shared";
import { createApiClient, isUnexpectedFailure, routeTemplate } from "./api";
import { CloudApiError } from "./errors";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function client(fetchImpl: unknown, opts: { signedIn?: boolean; onUnexpectedFailure?: (route: string, e: CloudApiError) => void } = {}) {
  const signedIn = opts.signedIn ?? true;
  return createApiClient({
    baseUrl: "https://api.example.test/",
    getIdToken: vi.fn(async () => (signedIn ? "id-token" : null)),
    isSignedIn: () => signedIn,
    getAppCheckToken: async () => "app-check-token",
    onUnexpectedFailure: opts.onUnexpectedFailure,
    fetch: fetchImpl as typeof fetch,
  });
}

const REPORT: ClientErrorReport = {
  kind: "uncaught",
  stage: null,
  code: "TypeError",
  message: "x is not a function",
  mode: "cloud",
  appVersion: "abc1234",
  device: { userAgent: "UA", webgpu: true, deviceMemoryGb: 8, mobile: false },
};

describe("reportClientError", () => {
  it("POSTs the report with App Check and a keepalive fetch; ID token only when signed in", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(null, { status: 204 }));
    await client(fetchMock).reportClientError(REPORT);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.example.test/client-errors");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual(REPORT);
    const headers = init.headers as Record<string, string>;
    expect(headers[APP_CHECK_HEADER]).toBe("app-check-token");
    expect(headers.Authorization).toBe("Bearer id-token");

    const signedOut = vi.fn(async (..._args: unknown[]) => new Response(null, { status: 204 }));
    await client(signedOut, { signedIn: false }).reportClientError(REPORT);
    expect((signedOut.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
  });

  it("never reports its own failures (no loops)", async () => {
    const onUnexpectedFailure = vi.fn();
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(client(failing, { onUnexpectedFailure }).reportClientError(REPORT)).rejects.toBeInstanceOf(CloudApiError);
    const fiveHundred = vi.fn(async () => new Response("oops", { status: 503 }));
    await expect(client(fiveHundred, { onUnexpectedFailure }).reportClientError(REPORT)).rejects.toBeInstanceOf(CloudApiError);
    expect(onUnexpectedFailure).not.toHaveBeenCalled();
  });
});

describe("onUnexpectedFailure", () => {
  it("fires for network errors and 5xx with an id-free route", async () => {
    const onUnexpectedFailure = vi.fn();
    const network = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await client(network, { onUnexpectedFailure }).reextract("SecretRecipeId123").catch(() => undefined);
    const server = vi.fn(async () => jsonResponse(500, { error: "boom", code: "internal", retryAfterSeconds: null }));
    await client(server, { onUnexpectedFailure }).publish("SecretRecipeId123", { visibility: "public", source: { kind: "own" }, tags: [], handle: null }).catch(() => undefined);

    expect(onUnexpectedFailure.mock.calls.map(([route, err]) => [route, (err as CloudApiError).code])).toEqual([
      ["POST /recipes/:id/reextract", "network"],
      ["POST /recipes/:id/publish", "internal"],
    ]);
    expect(JSON.stringify(onUnexpectedFailure.mock.calls)).not.toContain("SecretRecipeId123");
  });

  it("stays quiet for user-facing 4xx like quota_exceeded", async () => {
    const onUnexpectedFailure = vi.fn();
    const quota = vi.fn(async () => jsonResponse(429, { error: "quota", code: "quota_exceeded", retryAfterSeconds: 100 }));
    await client(quota, { onUnexpectedFailure }).createRecipe({} as never).catch(() => undefined);
    const notFound = vi.fn(async () => jsonResponse(404, { error: "nf", code: "not_found", retryAfterSeconds: null }));
    await client(notFound, { onUnexpectedFailure }).copyPublic("abcdefgh").catch(() => undefined);
    expect(onUnexpectedFailure).not.toHaveBeenCalled();
  });

  it("a throwing hook doesn't change the request's error", async () => {
    const network = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await client(network, {
      onUnexpectedFailure: () => {
        throw new Error("hook");
      },
    })
      .getMe()
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "network" });
  });
});

describe("routeTemplate / isUnexpectedFailure", () => {
  it.each([
    ["GET", "/me", "GET /me"],
    ["GET", "/sources/preview?url=https%3A%2F%2Fyoutu.be%2Fabc", "GET /sources/preview"],
    ["POST", "/public/aBcDeFgH123/like", "POST /public/:id/like"],
    ["POST", "/admin/public/xyz12345", "POST /admin/public/:id"],
    ["POST", "/recipes/me", "POST /recipes/me"],
  ])("%s %s", (method, path, expected) => {
    expect(routeTemplate(method, path)).toBe(expected);
  });

  it("classifies failures", () => {
    expect(isUnexpectedFailure(new CloudApiError("network", "", 0))).toBe(true);
    expect(isUnexpectedFailure(new CloudApiError("bad_response", "", 200))).toBe(true);
    expect(isUnexpectedFailure(new CloudApiError("upstream_error", "", 502))).toBe(true);
    expect(isUnexpectedFailure(new CloudApiError("quota_exceeded", "", 429))).toBe(false);
    expect(isUnexpectedFailure(new CloudApiError("unauthenticated", "", 401))).toBe(false);
  });
});
