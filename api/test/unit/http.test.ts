// HTTP layer with fake verifiers and no database — no emulator needed.
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { AppCheckVerifier, AuthAdmin } from "../../src/auth";
import { appError, sanitizedErrorLog, toErrorResponseParts } from "../../src/errors";
import { silentLogger } from "../../src/log";
import { readJsonBody } from "../../src/validation";
import { FakeClaude, json, TestClock, testConfig } from "../fixtures";

const NOW = new Date("2026-10-08T12:00:00Z");

function fakeAuth(authTimeSeconds = NOW.getTime() / 1000): AuthAdmin & { revokedChecks: boolean[] } {
  const revokedChecks: boolean[] = [];
  return {
    revokedChecks,
    async verifyIdToken(token: string, checkRevoked?: boolean) {
      revokedChecks.push(checkRevoked ?? false);
      if (token !== "good-id-token") throw new Error("auth/argument-error: bad token eyJhbGciOi.eyJzdWIiOi.c2ln");
      return { uid: "user-1", auth_time: authTimeSeconds } as DecodedIdToken;
    },
    async deleteUser() {},
  };
}

function fakeAppCheck(): AppCheckVerifier & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async verifyToken(token: string) {
      seen.push(token);
      if (token !== "good-app-check") throw new Error("invalid app check token");
      return {};
    },
  };
}

// A db that explodes if touched: these tests must be decided before any Firestore access.
const NO_DB = new Proxy({}, { get: () => { throw new Error("db must not be used"); } }) as Firestore;

function build(opts: { requireAppCheck?: boolean; auth?: AuthAdmin; appCheck?: AppCheckVerifier } = {}) {
  return createApp({
    db: NO_DB,
    auth: opts.auth ?? fakeAuth(),
    appCheck: opts.appCheck ?? fakeAppCheck(),
    claude: new FakeClaude(),
    config: testConfig({ requireAppCheck: opts.requireAppCheck ?? true }),
    now: new TestClock(NOW).now,
    logger: silentLogger,
  });
}

describe("App Check middleware", () => {
  it("rejects a missing token with 401 app_check_failed", async () => {
    const res = await build().request("/me", { headers: { Authorization: "Bearer good-id-token" } });
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({
      error: expect.any(String),
      code: "app_check_failed",
      retryAfterSeconds: null,
    });
  });

  it("rejects a token the verifier refuses, without leaking its error", async () => {
    const appCheck = fakeAppCheck();
    const res = await build({ appCheck }).request("/me", {
      headers: { Authorization: "Bearer good-id-token", "X-Firebase-AppCheck": "forged" },
    });
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.code).toBe("app_check_failed");
    expect(body.error).not.toContain("invalid app check token");
    expect(appCheck.seen).toEqual(["forged"]);
  });

  it("passes a valid token on to user auth", async () => {
    // Valid App Check, bad ID token → now it's the auth layer refusing.
    const res = await build().request("/me", {
      headers: { Authorization: "Bearer nope", "X-Firebase-AppCheck": "good-app-check" },
    });
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe("unauthenticated");
  });

  it("is skipped entirely when not required (emulator only)", async () => {
    const appCheck = fakeAppCheck();
    const res = await build({ requireAppCheck: false, appCheck }).request("/me", {});
    expect((await json(res)).code).toBe("unauthenticated");
    expect(appCheck.seen).toEqual([]);
  });
});

describe("ID token middleware", () => {
  const app = build({ requireAppCheck: false });

  it.each([
    ["no header", {}],
    ["not bearer", { Authorization: "Basic abc" }],
    ["empty bearer", { Authorization: "Bearer " }],
    ["invalid token", { Authorization: "Bearer bad" }],
  ])("401 unauthenticated for %s", async (_name, headers) => {
    const res = await app.request("/me", { headers });
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.code).toBe("unauthenticated");
    expect(JSON.stringify(body)).not.toContain("eyJ");
  });

  it("DELETE /me checks revocation and refuses a sign-in older than 10 minutes", async () => {
    const auth = fakeAuth(NOW.getTime() / 1000 - 11 * 60);
    const res = await build({ requireAppCheck: false, auth }).request("/me", {
      method: "DELETE",
      headers: { Authorization: "Bearer good-id-token" },
    });
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.code).toBe("unauthenticated");
    expect(body.error).toMatch(/sign in again/i);
    expect(auth.revokedChecks).toEqual([true]);
  });
});

describe("routing, CORS, errors", () => {
  const app = build({ requireAppCheck: false });

  it("GET /health needs no auth", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("unknown routes get a CloudError 404", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe("not_found");
  });

  it("answers preflight for allowed origins only", async () => {
    const ok = await app.request("/recipes", {
      method: "OPTIONS",
      headers: { Origin: "https://recipe-transcriber.pages.dev", "Access-Control-Request-Method": "POST" },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://recipe-transcriber.pages.dev");
    expect(ok.headers.get("access-control-allow-headers")).toContain("X-Firebase-AppCheck");

    const bad = await app.request("/recipes", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
    });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("error responses carry CORS headers so the browser can read them", async () => {
    const res = await app.request("/me", { headers: { Origin: "https://recipe-transcriber.pages.dev" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://recipe-transcriber.pages.dev");
  });

  it("refuses to build with an invalid config", () => {
    expect(() =>
      createApp({
        db: NO_DB,
        auth: fakeAuth(),
        appCheck: fakeAppCheck(),
        claude: new FakeClaude(),
        config: testConfig({ dailyBudgetUsd: Number.NaN }),
      }),
    ).toThrow();
  });
});

describe("errors", () => {
  it("never exposes unknown error text", () => {
    const { status, body } = toErrorResponseParts(new Error("401 invalid x-api-key sk-ant-abc"));
    expect(status).toBe(500);
    expect(body.code).toBe("internal");
    expect(body.error).not.toContain("sk-ant");
  });

  it("maps codes to statuses", () => {
    expect(toErrorResponseParts(appError("quota_exceeded", 42))).toMatchObject({
      status: 429,
      body: { code: "quota_exceeded", retryAfterSeconds: 42 },
    });
    expect(toErrorResponseParts(appError("budget_exhausted")).status).toBe(503);
    expect(toErrorResponseParts(appError("upstream_error")).status).toBe(502);
  });

  it("redacts live secrets, keys, and JWT-shaped tokens from logs", () => {
    const text = sanitizedErrorLog(
      new Error("failed with my-secret and sk-ant-api03-xyz and eyJhbGciOiJ.eyJzdWIiOiIx.c2lnbmF0dXJl"),
      ["my-secret"],
    );
    expect(text).not.toContain("my-secret");
    expect(text).not.toContain("sk-ant-api03");
    expect(text).not.toContain("eyJhbGciOiJ");
  });
});

describe("readJsonBody", () => {
  const req = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://x/", { method: "POST", body, headers });

  it("parses JSON", async () => {
    expect(await readJsonBody(req('{"a":1}'), 100)).toEqual({ a: 1 });
  });

  it("413s on a declared or actual oversize body", async () => {
    await expect(readJsonBody(req("x".repeat(10), { "content-length": "1000" }), 100)).rejects.toMatchObject({
      code: "too_large",
    });
    await expect(readJsonBody(req(JSON.stringify("x".repeat(200))), 100)).rejects.toMatchObject({ code: "too_large" });
  });

  it("400s on malformed JSON or no body", async () => {
    await expect(readJsonBody(req("{nope"), 100)).rejects.toMatchObject({ code: "bad_request" });
    await expect(readJsonBody(new Request("http://x/", { method: "POST" }), 100)).rejects.toMatchObject({
      code: "bad_request",
    });
  });
});
