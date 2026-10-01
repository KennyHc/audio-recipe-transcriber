import { describe, expect, it, vi } from "vitest";
import type { FetchFn } from "../src/turnstile";
import { verifyTurnstile } from "../src/turnstile";

function fakeFetch(response: { success: boolean }, ok = true) {
  return vi.fn<FetchFn>(async () => new Response(JSON.stringify(response), { status: ok ? 200 : 500 }));
}

describe("verifyTurnstile", () => {
  it("returns false immediately when there is no token (no network call made)", async () => {
    const fetchFn = fakeFetch({ success: true });
    const ok = await verifyTurnstile(fetchFn as any, "secret", null, "1.2.3.4");
    expect(ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns true when Cloudflare reports success", async () => {
    const fetchFn = fakeFetch({ success: true });
    const ok = await verifyTurnstile(fetchFn as any, "secret", "a-token", "1.2.3.4");
    expect(ok).toBe(true);
  });

  it("returns false when Cloudflare reports failure", async () => {
    const fetchFn = fakeFetch({ success: false });
    const ok = await verifyTurnstile(fetchFn as any, "secret", "a-token", "1.2.3.4");
    expect(ok).toBe(false);
  });

  it("returns false on a non-ok HTTP response", async () => {
    const fetchFn = fakeFetch({ success: true }, false);
    const ok = await verifyTurnstile(fetchFn as any, "secret", "a-token", "1.2.3.4");
    expect(ok).toBe(false);
  });

  it("returns false if the network call throws", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    const ok = await verifyTurnstile(fetchFn as any, "secret", "a-token", "1.2.3.4");
    expect(ok).toBe(false);
  });

  it("posts the secret, response token, and remoteip as form fields", async () => {
    const fetchFn = fakeFetch({ success: true });
    await verifyTurnstile(fetchFn as any, "my-secret", "the-token", "9.9.9.9");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = new URLSearchParams((init as RequestInit).body as string);
    expect(body.get("secret")).toBe("my-secret");
    expect(body.get("response")).toBe("the-token");
    expect(body.get("remoteip")).toBe("9.9.9.9");
  });
});
