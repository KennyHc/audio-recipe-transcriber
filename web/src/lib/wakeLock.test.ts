import { describe, expect, it, vi } from "vitest";
import { holdScreenWakeLock, type WakeLockEnv } from "./wakeLock";

function fakeEnv(initial: DocumentVisibilityState = "visible") {
  const listeners = new Set<() => void>();
  const sentinels: { release: ReturnType<typeof vi.fn>; fireRelease: () => void }[] = [];
  const request = vi.fn(async () => {
    let onRelease: (() => void) | null = null;
    const s = {
      release: vi.fn(async () => undefined),
      addEventListener: (_t: "release", l: () => void) => {
        onRelease = l;
      },
      fireRelease: () => onRelease?.(),
    };
    sentinels.push(s);
    return s;
  });
  const doc = {
    visibilityState: initial,
    addEventListener: (_t: string, l: () => void) => listeners.add(l),
    removeEventListener: (_t: string, l: () => void) => listeners.delete(l),
  };
  const env = { navigator: { wakeLock: { request } }, document: doc } as unknown as WakeLockEnv;
  const setVisibility = (v: DocumentVisibilityState) => {
    doc.visibilityState = v;
    for (const l of [...listeners]) l();
  };
  return { env, request, sentinels, listeners, setVisibility };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("holdScreenWakeLock", () => {
  it("requests a screen lock and releases it", async () => {
    const f = fakeEnv();
    const release = holdScreenWakeLock(f.env);
    await flush();
    expect(f.request).toHaveBeenCalledWith("screen");
    release();
    expect(f.sentinels[0]!.release).toHaveBeenCalledTimes(1);
    expect(f.listeners.size).toBe(0);
  });

  it("re-acquires when the tab becomes visible again after the OS released it", async () => {
    const f = fakeEnv();
    const release = holdScreenWakeLock(f.env);
    await flush();
    f.sentinels[0]!.fireRelease(); // hidden → the OS drops the lock
    f.setVisibility("hidden");
    await flush();
    expect(f.request).toHaveBeenCalledTimes(1);
    f.setVisibility("visible");
    await flush();
    expect(f.request).toHaveBeenCalledTimes(2);
    release();
    expect(f.sentinels[1]!.release).toHaveBeenCalled();
  });

  it("waits until visible when started in a hidden tab", async () => {
    const f = fakeEnv("hidden");
    holdScreenWakeLock(f.env);
    await flush();
    expect(f.request).not.toHaveBeenCalled();
    f.setVisibility("visible");
    await flush();
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it("releases a lock that arrives after release() was called", async () => {
    const f = fakeEnv();
    const release = holdScreenWakeLock(f.env);
    release(); // before the request settles
    await flush();
    expect(f.sentinels[0]!.release).toHaveBeenCalledTimes(1);
  });

  it("never throws: unsupported API, rejected request, missing document", async () => {
    expect(() => holdScreenWakeLock({ navigator: {}, document: fakeEnv().env.document })()).not.toThrow();
    expect(() => holdScreenWakeLock({})()).not.toThrow();
    const f = fakeEnv();
    f.request.mockRejectedValueOnce(new Error("NotAllowedError"));
    const release = holdScreenWakeLock(f.env);
    await flush();
    expect(() => release()).not.toThrow();
  });

  it("does nothing more after release, even on visibility changes", async () => {
    const f = fakeEnv();
    const release = holdScreenWakeLock(f.env);
    await flush();
    release();
    release(); // idempotent
    f.setVisibility("visible");
    await flush();
    expect(f.request).toHaveBeenCalledTimes(1);
  });
});
