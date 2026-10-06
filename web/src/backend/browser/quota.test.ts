import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchQuota } from "./quota";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("fetchQuota", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:8788");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the parsed quota on success", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, { limit: 20, remaining: 17, resetsInSeconds: 3600 }),
    );
    const result = await fetchQuota();
    expect(result).toEqual({ limit: 20, remaining: 17, resetsInSeconds: 3600 });
    expect(fetch).toHaveBeenCalledWith("http://localhost:8788/quota", { method: "GET" });
  });

  it("returns null when VITE_API_BASE is not configured", async () => {
    vi.unstubAllEnvs();
    const result = await fetchQuota();
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns null on a network failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    expect(await fetchQuota()).toBeNull();
  });

  it("returns null on a non-2xx response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(500, { error: "oops" }));
    expect(await fetchQuota()).toBeNull();
  });

  it("returns null on invalid JSON", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("not json", { status: 200 }));
    expect(await fetchQuota()).toBeNull();
  });

  it("returns null when the payload fails schema validation", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { limit: "twenty" }));
    expect(await fetchQuota()).toBeNull();
  });

  it("strips a trailing slash from VITE_API_BASE", async () => {
    vi.stubEnv("VITE_API_BASE", "http://localhost:8788/");
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { limit: 20, remaining: 20, resetsInSeconds: 1 }));
    await fetchQuota();
    expect(fetch).toHaveBeenCalledWith("http://localhost:8788/quota", { method: "GET" });
  });
});
