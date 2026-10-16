import { describe, expect, it, vi } from "vitest";
import type { BeaconKind } from "@recipe/shared";
import { beaconDedupeKey, createBeaconSender, privacySignalOn } from "./analytics";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe("createBeaconSender", () => {
  it("sends each kind once per page session", () => {
    const post = vi.fn();
    const storage = memoryStorage();
    const send = createBeaconSender({ post, storage: () => storage, privacySignal: () => false });
    send("visit");
    send("visit");
    send("explore_view");
    send("explore_view");
    expect(post.mock.calls.map((c) => c[0])).toEqual(["visit", "explore_view"]);
  });

  it("dedupes recipe_view per recipe id, and never sends the id", () => {
    const post = vi.fn();
    const storage = memoryStorage();
    const send = createBeaconSender({ post, storage: () => storage, privacySignal: () => false });
    send("recipe_view", "abc");
    send("recipe_view", "abc");
    send("recipe_view", "def");
    expect(post).toHaveBeenCalledTimes(2);
    for (const call of post.mock.calls) expect(call).toEqual(["recipe_view"]);
  });

  it("remembers what was sent across page loads in the same session (sessionStorage)", () => {
    const storage = memoryStorage();
    const first = vi.fn();
    createBeaconSender({ post: first, storage: () => storage, privacySignal: () => false })("visit");
    const second = vi.fn(); // a refresh: new sender, same session storage
    createBeaconSender({ post: second, storage: () => storage, privacySignal: () => false })("visit");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(storage.map.has(beaconDedupeKey("visit"))).toBe(true);
  });

  it("still dedupes in memory when sessionStorage throws", () => {
    const post = vi.fn();
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    const send = createBeaconSender({ post, storage: () => broken, privacySignal: () => false });
    send("visit");
    send("visit");
    expect(post).toHaveBeenCalledTimes(1);
    const noStorage = vi.fn();
    const send2 = createBeaconSender({
      post: noStorage,
      storage: () => {
        throw new Error("blocked");
      },
      privacySignal: () => false,
    });
    expect(() => send2("visit")).not.toThrow();
    expect(noStorage).toHaveBeenCalledTimes(1);
  });

  it("sends nothing under Do Not Track / Global Privacy Control", () => {
    const post = vi.fn();
    const storage = memoryStorage();
    const send = createBeaconSender({ post, storage: () => storage, privacySignal: () => true });
    for (const kind of ["visit", "recipe_view", "explore_view", "captions_used"] as BeaconKind[]) send(kind);
    expect(post).not.toHaveBeenCalled();
    expect(storage.map.size).toBe(0);
  });

  it("never throws or rejects when sending fails", async () => {
    const throwing = createBeaconSender({
      post: () => {
        throw new Error("boom");
      },
      storage: () => memoryStorage(),
      privacySignal: () => false,
    });
    expect(() => throwing("visit")).not.toThrow();
    const rejecting = createBeaconSender({
      post: () => Promise.reject(new Error("offline")),
      storage: () => memoryStorage(),
      privacySignal: () => false,
    });
    expect(() => rejecting("visit")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // no unhandled rejection
  });
});

describe("privacySignalOn", () => {
  it("reads DNT and GPC", () => {
    expect(privacySignalOn({}, {})).toBe(false);
    expect(privacySignalOn({ doNotTrack: "0" }, {})).toBe(false);
    expect(privacySignalOn({ doNotTrack: "unspecified" }, null)).toBe(false);
    expect(privacySignalOn({ doNotTrack: "1" }, {})).toBe(true);
    expect(privacySignalOn({ doNotTrack: "yes" }, {})).toBe(true); // old Firefox
    expect(privacySignalOn({}, { doNotTrack: "1" })).toBe(true); // old IE/Safari
    expect(privacySignalOn({ globalPrivacyControl: true }, {})).toBe(true);
    expect(privacySignalOn({ globalPrivacyControl: false }, {})).toBe(false);
    expect(privacySignalOn(null, null)).toBe(false);
  });
});

describe("track / setAnalyticsSender", () => {
  it("queues until a sender is registered, then flushes in order with keys", async () => {
    vi.resetModules();
    const mod = await import("./analytics");
    mod.track("visit");
    mod.track("recipe_view", "r1");
    const sender = vi.fn();
    mod.setAnalyticsSender(sender);
    expect(sender.mock.calls).toEqual([
      ["visit", undefined],
      ["recipe_view", "r1"],
    ]);
    mod.track("explore_view");
    expect(sender).toHaveBeenLastCalledWith("explore_view", undefined);
    mod.setAnalyticsSender(() => {
      throw new Error("boom");
    });
    expect(() => mod.track("visit")).not.toThrow();
  });
});
