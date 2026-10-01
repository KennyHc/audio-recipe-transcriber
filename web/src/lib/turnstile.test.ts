import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetTurnstileForTests, getTurnstileToken } from "./turnstile";

// There's no jsdom in this project's test environment (see backend/browser/*.test.ts, which
// polyfill only what each module needs) — so document/window are built here as minimal fakes
// giving turnstile.ts exactly the DOM surface it uses: creating/appending a <script> and a
// <div>, plus a window.turnstile object this suite fully controls.

interface FakeElement {
  tagName: string;
  id: string;
  src: string;
  style: Record<string, string>;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

function makeElement(tagName: string): FakeElement {
  return { tagName, id: "", src: "", style: {}, onload: null, onerror: null };
}

class FakeTurnstile {
  rendered: { container: unknown; options: Record<string, unknown> }[] = [];
  resets: (string | undefined)[] = [];
  executes: unknown[] = [];
  readonly widgetId = "widget-1";

  render(container: unknown, options: Record<string, unknown>): string {
    this.rendered.push({ container, options });
    return this.widgetId;
  }
  execute(container: unknown): void {
    this.executes.push(container);
  }
  reset(widgetId?: string): void {
    this.resets.push(widgetId);
  }
  remove(): void {
    /* unused by turnstile.ts */
  }

  succeed(token: string) {
    (this.rendered[0]!.options.callback as (t: string) => void)(token);
  }
  fail() {
    (this.rendered[0]!.options["error-callback"] as () => void)();
  }
}

let headChildren: FakeElement[];
let bodyById: Map<string, FakeElement>;
let fakeTurnstile: FakeTurnstile;
let fakeWindow: { turnstile?: FakeTurnstile };

function installDom() {
  headChildren = [];
  bodyById = new Map();
  fakeTurnstile = new FakeTurnstile();
  fakeWindow = {};

  const fakeDocument = {
    createElement: (tag: string) => makeElement(tag),
    getElementById: (id: string) => bodyById.get(id) ?? null,
    head: {
      appendChild: (el: FakeElement) => headChildren.push(el),
    },
    body: {
      appendChild: (el: FakeElement) => bodyById.set(el.id, el),
    },
  };

  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("window", fakeWindow);
}

/** Drives the fake script tag's onload once it's been appended (loadScript's promise settles on this). */
function finishScriptLoad() {
  fakeWindow.turnstile = fakeTurnstile;
  headChildren[0]!.onload?.();
}

describe("getTurnstileToken", () => {
  beforeEach(() => {
    _resetTurnstileForTests();
    vi.useFakeTimers();
    installDom();
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("loads the script, renders an invisible execute-mode widget, resets then executes, and resolves on success", async () => {
    const tokenPromise = getTurnstileToken();

    await vi.waitFor(() => expect(headChildren.length).toBe(1));
    finishScriptLoad();

    await vi.waitFor(() => expect(fakeTurnstile.rendered.length).toBe(1));
    const { options } = fakeTurnstile.rendered[0]!;
    expect(options.sitekey).toBe("1x00000000000000000000AA");
    expect(options.size).toBe("invisible");
    expect(options.execution).toBe("execute");

    await vi.waitFor(() => expect(fakeTurnstile.executes.length).toBe(1));
    expect(fakeTurnstile.resets).toEqual([fakeTurnstile.widgetId]); // reset happens before execute

    fakeTurnstile.succeed("fresh-token-1");

    await expect(tokenPromise).resolves.toBe("fresh-token-1");
  });

  it("renders the widget only once across repeated calls, but resets + executes every time", async () => {
    const first = getTurnstileToken();
    await vi.waitFor(() => expect(headChildren.length).toBe(1));
    finishScriptLoad();
    await vi.waitFor(() => expect(fakeTurnstile.executes.length).toBe(1));
    fakeTurnstile.succeed("token-a");
    await expect(first).resolves.toBe("token-a");

    const second = getTurnstileToken();
    await vi.waitFor(() => expect(fakeTurnstile.executes.length).toBe(2));
    fakeTurnstile.succeed("token-b");
    await expect(second).resolves.toBe("token-b");

    expect(fakeTurnstile.rendered.length).toBe(1); // render() only happened once
    expect(fakeTurnstile.resets.length).toBe(2); // but reset() before every execute
  });

  it("rejects with a friendly message when the widget reports an error", async () => {
    const tokenPromise = getTurnstileToken();
    await vi.waitFor(() => expect(headChildren.length).toBe(1));
    finishScriptLoad();
    await vi.waitFor(() => expect(fakeTurnstile.rendered.length).toBe(1));

    fakeTurnstile.fail();

    await expect(tokenPromise).rejects.toThrow(/Couldn't verify this browser/);
  });

  it("rejects after ~15s if the widget never responds", async () => {
    const tokenPromise = getTurnstileToken();
    const assertion = expect(tokenPromise).rejects.toThrow(/Timed out verifying this browser/);
    // Never deliver finishScriptLoad() — simulate a blocked/slow network.
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it("rejects when VITE_TURNSTILE_SITE_KEY is not configured", async () => {
    vi.unstubAllEnvs();
    const tokenPromise = getTurnstileToken();

    await vi.waitFor(() => expect(headChildren.length).toBe(1));
    finishScriptLoad();

    await expect(tokenPromise).rejects.toThrow(/VITE_TURNSTILE_SITE_KEY/);
  });
});
