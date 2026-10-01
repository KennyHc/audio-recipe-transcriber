import { describe, expect, it } from "vitest";
import { AppError, appError, sanitizedErrorLog, toErrorResponseParts } from "../src/errors";

describe("appError", () => {
  it("maps each code to its documented status", () => {
    expect(appError("bad_request").status).toBe(400);
    expect(appError("too_large").status).toBe(413);
    expect(appError("bot_check_failed").status).toBe(403);
    expect(appError("rate_limited").status).toBe(429);
    expect(appError("budget_exhausted").status).toBe(503);
    expect(appError("upstream_error").status).toBe(502);
  });

  it("carries retryAfterSeconds through", () => {
    expect(appError("rate_limited", 120).retryAfterSeconds).toBe(120);
    expect(appError("bad_request").retryAfterSeconds).toBeNull();
  });
});

describe("toErrorResponseParts", () => {
  it("uses the generic message for an AppError, not whatever message it was constructed with", () => {
    const err = new AppError("upstream_error", 502, "some internal detail that must not leak");
    const { status, body } = toErrorResponseParts(err);
    expect(status).toBe(502);
    expect(body.code).toBe("upstream_error");
    expect(body.error).not.toContain("internal detail");
    expect(body.error).toBe("The recipe service had a problem — please try again.");
  });

  it("maps any non-AppError to a generic upstream_error, never exposing its message", () => {
    const secretish = new Error("Anthropic request failed: Authorization: Bearer sk-ant-totally-real-key");
    const { status, body } = toErrorResponseParts(secretish);
    expect(status).toBe(502);
    expect(body.code).toBe("upstream_error");
    expect(JSON.stringify(body)).not.toContain("sk-ant-totally-real-key");
  });

  it("handles non-Error throws safely too", () => {
    const { status, body } = toErrorResponseParts("sk-ant-plain-string-throw");
    expect(status).toBe(502);
    expect(JSON.stringify(body)).not.toContain("sk-ant-plain-string-throw");
  });
});

describe("sanitizedErrorLog", () => {
  it("redacts every occurrence of each given secret", () => {
    const err = new Error("auth failed for key sk-ant-SECRET123 and again sk-ant-SECRET123");
    const line = sanitizedErrorLog(err, ["sk-ant-SECRET123"]);
    expect(line).not.toContain("sk-ant-SECRET123");
    expect(line).toContain("[redacted]");
  });

  it("redacts multiple distinct secrets", () => {
    const err = new Error("key=sk-ant-ONE salt=mysalt42");
    const line = sanitizedErrorLog(err, ["sk-ant-ONE", "mysalt42"]);
    expect(line).not.toContain("sk-ant-ONE");
    expect(line).not.toContain("mysalt42");
  });

  it("ignores empty secret values instead of mangling the message", () => {
    const err = new Error("plain message");
    expect(sanitizedErrorLog(err, ["", "unused-secret"])).toContain("plain message");
  });
});
