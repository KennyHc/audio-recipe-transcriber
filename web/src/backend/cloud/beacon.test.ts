// The anonymous beacon and admin stats routes through the API client (contract: shared/stats.ts).
import { describe, expect, it, vi } from "vitest";
import { APP_CHECK_HEADER } from "@recipe/shared";
import { createApiClient, routeTemplate } from "./api";
import { CloudApiError } from "./errors";

function client(fetchImpl: unknown, onUnexpectedFailure?: (route: string, e: CloudApiError) => void) {
  const getIdToken = vi.fn(async () => "id-token");
  const api = createApiClient({
    baseUrl: "https://api.example.test",
    getIdToken,
    isSignedIn: () => true, // signed in — the beacon must still carry no ID token
    getAppCheckToken: async () => "app-check-token",
    onUnexpectedFailure,
    fetch: fetchImpl as typeof fetch,
  });
  return { api, getIdToken };
}

describe("beacon", () => {
  it("POSTs {kind} with App Check, keepalive, and no Authorization header even when signed in", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(null, { status: 204 }));
    const { api, getIdToken } = client(fetchMock);
    await api.beacon("recipe_view");
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.example.test/beacon");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({ kind: "recipe_view" });
    const headers = init.headers as Record<string, string>;
    expect(headers[APP_CHECK_HEADER]).toBe("app-check-token");
    expect(headers.Authorization).toBeUndefined();
    expect(Object.keys(headers).sort()).toEqual([APP_CHECK_HEADER, "Content-Type"].sort());
    expect(init.credentials).toBeUndefined();
    expect(getIdToken).not.toHaveBeenCalled();
  });

  it("doesn't report its own failures", async () => {
    const onUnexpectedFailure = vi.fn();
    const { api } = client(
      vi.fn(async () => new Response("down", { status: 503 })),
      onUnexpectedFailure,
    );
    await expect(api.beacon("visit")).rejects.toBeInstanceOf(CloudApiError);
    expect(onUnexpectedFailure).not.toHaveBeenCalled();
  });

  it("has an id-free route template", () => {
    expect(routeTemplate("POST", "/beacon")).toBe("POST /beacon");
    expect(routeTemplate("GET", "/admin/stats?days=30")).toBe("GET /admin/stats");
  });
});

describe("adminStats", () => {
  const day = (date: string, visit = 0) => ({
    date,
    visit,
    recipe_view: 0,
    explore_view: 0,
    captions_used: 0,
    signup: 0,
    recipe_created: 0,
    publish: 0,
  });

  it("GETs /admin/stats?days=N with the ID token and parses the response", async () => {
    const fetchMock = vi.fn(
      async (..._args: unknown[]) =>
        new Response(JSON.stringify({ days: [day("2026-10-15", 3), day("2026-10-16", 5)] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const { api } = client(fetchMock);
    const res = await api.adminStats(30);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.example.test/admin/stats?days=30");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer id-token");
    expect(res.days.map((d) => d.visit)).toEqual([3, 5]);
  });

  it("rejects a response that doesn't match the contract", async () => {
    const { api } = client(
      vi.fn(async () => new Response(JSON.stringify({ days: [{ date: "2026-10-16", visit: "many" }] }), { status: 200 })),
    );
    await expect(api.adminStats(14)).rejects.toMatchObject({ code: "bad_response" });
  });
});
