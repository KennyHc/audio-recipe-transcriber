import { describe, expect, it, vi } from "vitest";
import { ClientErrorReport } from "@recipe/shared";
import {
  appVersion,
  buildReport,
  cleanMessage,
  createErrorReporter,
  currentMode,
  deviceFacts,
  errorCodeOf,
  installGlobalErrorHandlers,
  MAX_REPORTS_PER_SESSION,
  scrubMessage,
  type DeviceFacts,
} from "./errorReporting";

const DEVICE: DeviceFacts = { userAgent: "Mozilla/5.0 (iPhone)", webgpu: false, deviceMemoryGb: 4, mobile: true };
const ENV = { mode: "cloud" as const, appVersion: "abc1234", device: DEVICE };

describe("cleanMessage (scrub + shared sanitizer)", () => {
  it.each([
    ["Failed to load https://api.example.com/recipes/aB3dE5fG9hJ?x=1", "Failed to load <url>"],
    ["Couldn't decode Egg Fried Rice.mp3", "Couldn't decode Egg Fried <file>"],
    ["Couldn't decode egg-fried-rice.m4a (unsupported)", "Couldn't decode <file> (unsupported)"],
    ["Cannot open blob:https://app.web.app/1234-abcd", "Cannot open <url>"],
    ["read failed at /Users/kenny/Music/clip.wav", "read failed at <path>"],
    ["Sent link to kenny@example.com", "Sent link to <email>"],
    ['Unexpected token \'S\', "Some recip"... is not valid JSON', "Unexpected token 'S', <text>... is not valid JSON"],
    ["Bad item 'two cloves of garlic' in list", "Bad item <text> in list"],
    ["Recipe AbCdEfGhIjKlMnOpQrSt12 not found", "Recipe <id> not found"],
    ["Recipe xY7kQ2pL not found", "Recipe <id> not found"],
    ["job 3f2a1c4e-9b8d-4e7f-a6b5-1c2d3e4f5a6b failed", "job <id> failed"],
    ["call me 0123456789", "call me <n>"],
  ])("%s", (input, expected) => {
    expect(cleanMessage(input)).toBe(expected);
  });

  it("keeps useful technical words", () => {
    expect(cleanMessage("Cannot read properties of undefined (reading 'title')")).toBe(
      "Cannot read properties of undefined (reading 'title')",
    );
    expect(cleanMessage("Float32Array length mismatch in Uint8Array")).toBe("Float32Array length mismatch in Uint8Array");
    expect(cleanMessage("WebGPU is not supported")).toBe("WebGPU is not supported");
  });

  it("drops transcript text even when it's long and multi-line", () => {
    const transcript = "so you take two cloves of garlic and\nthen you add the rice, about two cups";
    expect(cleanMessage(`Extraction failed for "${transcript}"`)).toBe("Extraction failed for <text>");
    expect(cleanMessage(`Extraction failed for “${transcript}”`)).toBe("Extraction failed for <text>");
  });

  it("caps the length at 300", () => {
    expect(cleanMessage("word ".repeat(200)).length).toBeLessThanOrEqual(300);
  });

  it("scrubMessage alone leaves plain text alone", () => {
    expect(scrubMessage("Out of memory")).toBe("Out of memory");
  });
});

describe("errorCodeOf", () => {
  it("uses a code, then a name, skipping the generic Error", () => {
    expect(errorCodeOf(Object.assign(new Error("x"), { code: "quota_exceeded" }))).toBe("quota_exceeded");
    expect(errorCodeOf(new DOMException("x", "QuotaExceededError"))).toBe("QuotaExceededError");
    expect(errorCodeOf(new TypeError("x"))).toBe("TypeError");
    expect(errorCodeOf(new Error("x"))).toBeNull();
    expect(errorCodeOf("string")).toBeNull();
    expect(errorCodeOf({ code: "has spaces and user text" })).toBeNull();
  });
});

describe("deviceFacts", () => {
  it("reads WebGPU, memory and mobile", () => {
    expect(deviceFacts({ userAgent: "UA", gpu: {}, deviceMemory: 8, userAgentData: { mobile: false } })).toEqual({
      userAgent: "UA",
      webgpu: true,
      deviceMemoryGb: 8,
      mobile: false,
    });
  });
  it("falls back to the user agent for mobile and handles missing facts", () => {
    expect(deviceFacts({ userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile" })).toEqual({
      userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile",
      webgpu: false,
      deviceMemoryGb: null,
      mobile: true,
    });
    expect(deviceFacts(null)).toEqual({ userAgent: "", webgpu: null, deviceMemoryGb: null, mobile: false });
  });
  it("caps the user agent", () => {
    expect(deviceFacts({ userAgent: "x".repeat(400) }).userAgent).toHaveLength(300);
  });
});

describe("buildReport", () => {
  it("builds a contract-valid report with only codes and facts", () => {
    const err = Object.assign(new Error('Upload "Grandma\'s secret curry.mp3" failed at https://x.io/a/b for a@b.co'), {
      code: "upstream_error",
    });
    const report = buildReport({ kind: "pipeline", stage: "extracting", error: err }, ENV);
    expect(ClientErrorReport.safeParse(report).success).toBe(true);
    expect(report).toEqual({
      kind: "pipeline",
      stage: "extracting",
      code: "upstream_error",
      message: "Upload <text> failed at <url> for <email>",
      mode: "cloud",
      appVersion: "abc1234",
      device: DEVICE,
    });
    const json = JSON.stringify(report);
    for (const leak of ["Grandma", "curry", ".mp3", "x.io", "a@b.co"]) expect(json).not.toContain(leak);
  });

  it("handles strings, non-errors and nothing", () => {
    expect(buildReport({ kind: "uncaught", error: "boom" }, ENV).message).toBe("boom");
    expect(buildReport({ kind: "uncaught", error: 42 }, ENV).message).toBe("Non-error value thrown");
    expect(buildReport({ kind: "uncaught" }, ENV)).toMatchObject({ message: "", stage: null, code: null });
  });

  it("keeps stage route templates intact and within limits", () => {
    const r = buildReport({ kind: "api", stage: "POST /recipes/:id/publish/suggestions", code: "internal", error: new Error("x") }, ENV);
    expect(r.stage).toBe("POST /recipes/:id/publish/suggestions");
    expect(buildReport({ kind: "api", stage: "s".repeat(80), error: null }, ENV).stage).toHaveLength(40);
  });
});

describe("createErrorReporter", () => {
  function setup(enabled = true) {
    const sent: ClientErrorReport[] = [];
    const reporter = createErrorReporter({ enabled, env: () => ENV });
    reporter.setSender((r) => {
      sent.push(r);
    });
    return { reporter, sent };
  }

  it("sends nothing when disabled (every non-cloud build)", () => {
    const { reporter, sent } = setup(false);
    reporter.report({ kind: "uncaught", error: new Error("x") });
    expect(sent).toEqual([]);
  });

  it("deduplicates identical reports within the session", () => {
    const { reporter, sent } = setup();
    reporter.report({ kind: "uncaught", error: new Error("same") });
    reporter.report({ kind: "uncaught", error: new Error("same") });
    reporter.report({ kind: "uncaught", stage: "x", error: new Error("same") });
    expect(sent).toHaveLength(2);
  });

  it("dedupes reports that differ only in scrubbed details", () => {
    const { reporter, sent } = setup();
    reporter.report({ kind: "api", error: new Error("GET https://a.io/recipes/one failed") });
    reporter.report({ kind: "api", error: new Error("GET https://a.io/recipes/two failed") });
    expect(sent).toHaveLength(1);
  });

  it(`caps at ${MAX_REPORTS_PER_SESSION} per session`, () => {
    const { reporter, sent } = setup();
    for (let i = 0; i < 30; i++) reporter.report({ kind: "uncaught", error: new Error(`error number ${i}`) });
    expect(sent).toHaveLength(MAX_REPORTS_PER_SESSION);
  });

  it("reports the same error object once (markReported / wasReported)", () => {
    const { reporter, sent } = setup();
    const err = new Error("x");
    reporter.markReported(err);
    reporter.report({ kind: "pipeline", error: err });
    expect(sent).toEqual([]);
    const other = new Error("y");
    reporter.report({ kind: "api", error: other });
    expect(reporter.wasReported(other)).toBe(true);
    expect(reporter.wasReported("not an object")).toBe(false);
  });

  it("queues reports made before the sender is registered", () => {
    const reporter = createErrorReporter({ enabled: true, env: () => ENV });
    reporter.report({ kind: "uncaught", error: new Error("early") });
    const sender = vi.fn();
    reporter.setSender(sender);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]![0].message).toBe("early");
  });

  it("never throws, even if the sender throws or rejects, or the env fails", async () => {
    const reporter = createErrorReporter({ enabled: true, env: () => ENV });
    reporter.setSender(() => {
      throw new Error("sync");
    });
    expect(() => reporter.report({ kind: "uncaught", error: new Error("a") })).not.toThrow();
    reporter.setSender(() => Promise.reject(new Error("async")));
    expect(() => reporter.report({ kind: "uncaught", error: new Error("b") })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // no unhandled rejection
    const broken = createErrorReporter({
      enabled: true,
      env: () => {
        throw new Error("env");
      },
    });
    expect(() => broken.report({ kind: "uncaught", error: new Error("c") })).not.toThrow();
  });
});

describe("installGlobalErrorHandlers", () => {
  it("reports window errors and unhandled rejections, skipping noise", () => {
    const handlers: Record<string, (e: unknown) => void> = {};
    const target = { addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn) } as unknown as Window;
    const reports: unknown[] = [];
    const reporter = createErrorReporter({ enabled: true, env: () => ENV });
    reporter.setSender((r) => {
      reports.push(r);
    });
    installGlobalErrorHandlers(target, reporter);

    handlers.error!({ message: "Script error.", error: null });
    handlers.error!({ message: "ResizeObserver loop completed with undelivered notifications.", error: null });
    handlers.error!({ message: "x", error: new TypeError("a is not a function") });
    handlers.unhandledrejection!({ reason: new DOMException("aborted", "AbortError") });
    handlers.unhandledrejection!({ reason: new Error("lost") });

    expect(reports).toMatchObject([
      { kind: "uncaught", stage: "error", code: "TypeError", message: "a is not a function" },
      { kind: "uncaught", stage: "unhandledrejection", code: null, message: "lost" },
    ]);
  });
});

describe("build facts", () => {
  it("has a mode and an app version", () => {
    expect(["server", "browser", "hosted", "cloud"]).toContain(currentMode());
    expect(appVersion()).toMatch(/^[\w.-]{1,40}$/);
  });
});
