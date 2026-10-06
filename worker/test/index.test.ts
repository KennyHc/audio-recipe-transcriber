import type { ExtractedRecipe, Transcript } from "@recipe/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyLimiterRequest, type MinimalStorage } from "../src/durableObjects/limiterLogic";
import type { LimiterRequest } from "../src/durableObjects/protocol";
import type { Env } from "../src/types";

const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { parse: parseMock };
    constructor(_opts: { apiKey: string }) {}
  },
}));

// Imported after the mock so src/index.ts picks up the mocked SDK.
const { default: worker } = await import("../src/index");

function fakeStorage(): MinimalStorage {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      data.set(key, value);
    },
  };
}

/** A DurableObjectNamespace-shaped fake that runs real limiter logic against in-memory storage. */
function fakeLimiterNamespace(): DurableObjectNamespace {
  const storage = fakeStorage();
  const stub = {
    fetch: async (request: Request) => {
      const body = (await request.json()) as LimiterRequest;
      const result = await applyLimiterRequest(storage, body);
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    },
  };
  return {
    idFromName: (_name: string) => ({ toString: () => "fake-id" }) as DurableObjectId,
    get: (_id: DurableObjectId) => stub as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace;
}

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    LIMITER: fakeLimiterNamespace(),
    ALLOWED_ORIGINS: "http://localhost:5182,http://localhost:5183",
    PER_VISITOR_DAILY_LIMIT: "20",
    DAILY_BUDGET_USD: "0.5",
    EXTRACTOR_MODEL: "claude-haiku-4-5",
    VERIFIER_MODEL: "claude-haiku-4-5",
    ANTHROPIC_API_KEY: "test-anthropic-key-NOT-REAL-12345",
    TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
    VISITOR_SALT: "test-salt",
    ...overrides,
  };
}

const TRANSCRIPT: Transcript = {
  language: "en",
  segments: [{ start: 0, end: 2, text: "two cups of flour" }],
};

const RECIPE: ExtractedRecipe = {
  title: "Test Recipe",
  description: null,
  servings: null,
  totalTimeMinutes: null,
  ingredients: [
    {
      quantity: 2,
      unit: "cup",
      item: "flour",
      prep: null,
      sourceText: "two cups of flour",
      timestamp: 0,
      confidence: "stated",
    },
  ],
  steps: [],
  tips: [],
};

function usage(overrides: Partial<Record<string, number>> = {}) {
  return {
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    ...overrides,
  };
}

function request(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`https://worker.test${path}`, {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:5182",
      "CF-Connecting-IP": "203.0.113.1",
      "X-Turnstile-Token": "valid-token",
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

function mockTurnstileSuccess() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    if (String(input).includes("turnstile")) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    throw new Error(`unexpected fetch to ${input}`);
  });
}

beforeEach(() => {
  parseMock.mockReset();
  vi.restoreAllMocks();
});

describe("routing", () => {
  it("404s unknown routes", async () => {
    mockTurnstileSuccess();
    const res = await worker.fetch(request("/nope", { method: "GET" }), testEnv());
    expect(res.status).toBe(404);
  });

  it("404s GET on a known path", async () => {
    const res = await worker.fetch(request("/extract", { method: "GET" }), testEnv());
    expect(res.status).toBe(404);
  });

  it("answers OPTIONS preflight with CORS headers for an allowed origin", async () => {
    const res = await worker.fetch(request("/extract", { method: "OPTIONS" }), testEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5182");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("X-Turnstile-Token");
  });

  it("omits CORS headers for a disallowed origin", async () => {
    const res = await worker.fetch(
      request("/extract", { method: "OPTIONS", headers: { Origin: "http://evil.example" } }),
      testEnv(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("omits CORS headers on an actual response to a disallowed origin", async () => {
    mockTurnstileSuccess();
    parseMock.mockResolvedValue({ parsed_output: RECIPE, stop_reason: "end_turn", usage: usage() });
    const res = await worker.fetch(
      request("/extract", { body: { transcript: TRANSCRIPT }, headers: { Origin: "http://evil.example" } }),
      testEnv(),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("POST /extract", () => {
  it("happy path returns the recipe and never leaks the API key", async () => {
    mockTurnstileSuccess();
    parseMock.mockResolvedValue({ parsed_output: RECIPE, stop_reason: "end_turn", usage: usage() });

    const env = testEnv();
    const res = await worker.fetch(request("/extract", { body: { transcript: TRANSCRIPT } }), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.recipe.title).toBe("Test Recipe");
    expect(JSON.stringify(json)).not.toContain(env.ANTHROPIC_API_KEY);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5182");
  });

  it("400s an invalid body", async () => {
    mockTurnstileSuccess();
    const res = await worker.fetch(request("/extract", { body: { transcript: { language: "en" } } }), testEnv());
    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.code).toBe("bad_request");
  });

  it("413s an oversized transcript", async () => {
    mockTurnstileSuccess();
    const huge: Transcript = { language: "en", segments: [{ start: 0, end: 1, text: "a".repeat(40_001) }] };
    const res = await worker.fetch(request("/extract", { body: { transcript: huge } }), testEnv());
    expect(res.status).toBe(413);
    const json = (await res.json()) as any;
    expect(json.code).toBe("too_large");
  });

  it("403s a missing Turnstile token", async () => {
    const fetchSpy = mockTurnstileSuccess();
    const res = await worker.fetch(
      request("/extract", { body: { transcript: TRANSCRIPT }, headers: { "X-Turnstile-Token": "" } }),
      testEnv(),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as any;
    expect(json.code).toBe("bot_check_failed");
    // No token -> verifyTurnstile short-circuits before any network call.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("403s a Turnstile failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));
    const res = await worker.fetch(request("/extract", { body: { transcript: TRANSCRIPT } }), testEnv());
    expect(res.status).toBe(403);
  });

  it("429s once the per-visitor daily limit is used up", async () => {
    mockTurnstileSuccess();
    parseMock.mockResolvedValue({ parsed_output: RECIPE, stop_reason: "end_turn", usage: usage() });
    const env = testEnv({ PER_VISITOR_DAILY_LIMIT: "1" });

    const first = await worker.fetch(request("/extract", { body: { transcript: TRANSCRIPT } }), env);
    expect(first.status).toBe(200);

    const second = await worker.fetch(request("/extract", { body: { transcript: TRANSCRIPT } }), env);
    expect(second.status).toBe(429);
    const json = (await second.json()) as any;
    expect(json.code).toBe("rate_limited");
    expect(json.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("503s once the daily budget is exhausted", async () => {
    mockTurnstileSuccess();
    parseMock.mockResolvedValue({ parsed_output: RECIPE, stop_reason: "end_turn", usage: usage() });
    // Budget far smaller than even the worst-case reservation for one call.
    const env = testEnv({ DAILY_BUDGET_USD: "0.0000001", PER_VISITOR_DAILY_LIMIT: "100" });

    const res = await worker.fetch(request("/extract", { body: { transcript: TRANSCRIPT } }), env);
    expect(res.status).toBe(503);
    const json = (await res.json()) as any;
    expect(json.code).toBe("budget_exhausted");
  });

  it("502s and releases the reservation when Claude refuses", async () => {
    mockTurnstileSuccess();
    parseMock.mockResolvedValue({ parsed_output: null, stop_reason: "refusal", usage: usage() });
    const env = testEnv();

    const res = await worker.fetch(request("/extract", { body: { transcript: TRANSCRIPT } }), env);
    expect(res.status).toBe(502);
    const json = (await res.json()) as any;
    expect(json.code).toBe("upstream_error");

    // Reservation should have been released: a second call with a tiny
    // budget big enough for exactly one reservation should still succeed.
    parseMock.mockResolvedValue({ parsed_output: RECIPE, stop_reason: "end_turn", usage: usage() });
    const res2 = await worker.fetch(request("/extract", { body: { transcript: TRANSCRIPT } }), env);
    expect(res2.status).toBe(200);
  });

  it("502s when the SDK throws, without leaking its message", async () => {
    mockTurnstileSuccess();
    parseMock.mockRejectedValue(new Error("Authorization: Bearer test-anthropic-key-NOT-REAL-12345 failed"));
    const res = await worker.fetch(request("/extract", { body: { transcript: TRANSCRIPT } }), testEnv());
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("test-anthropic-key-NOT-REAL-12345");
  });
});

describe("POST /verify", () => {
  it("happy path returns warnings with ensureAmountWarnings applied", async () => {
    mockTurnstileSuccess();
    parseMock.mockResolvedValue({ parsed_output: { warnings: [] }, stop_reason: "end_turn", usage: usage() });

    const vagueRecipe: ExtractedRecipe = {
      ...RECIPE,
      ingredients: [
        {
          quantity: null,
          unit: null,
          item: "salt",
          prep: null,
          sourceText: "some salt",
          timestamp: 0,
          confidence: "vague",
        },
      ],
    };

    const res = await worker.fetch(
      request("/verify", { body: { transcript: TRANSCRIPT, recipe: vagueRecipe } }),
      testEnv(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.warnings).toHaveLength(1);
    expect(json.warnings[0].kind).toBe("vague_quantity");
  });

  it("does not count against the per-visitor /extract limit", async () => {
    mockTurnstileSuccess();
    parseMock.mockResolvedValue({ parsed_output: { warnings: [] }, stop_reason: "end_turn", usage: usage() });
    const env = testEnv({ PER_VISITOR_DAILY_LIMIT: "1" });

    for (let i = 0; i < 3; i++) {
      const res = await worker.fetch(request("/verify", { body: { transcript: TRANSCRIPT, recipe: RECIPE } }), env);
      expect(res.status).toBe(200);
    }
  });
});

describe("GET /quota", () => {
  it("returns the full limit for a new visitor", async () => {
    const env = testEnv({ PER_VISITOR_DAILY_LIMIT: "20" });
    const res = await worker.fetch(request("/quota", { method: "GET" }), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json).toEqual({ limit: 20, remaining: 20, resetsInSeconds: expect.any(Number) });
    expect(json.resetsInSeconds).toBeGreaterThan(0);
  });

  it("decreases after an /extract and never counts negative", async () => {
    mockTurnstileSuccess();
    parseMock.mockResolvedValue({ parsed_output: RECIPE, stop_reason: "end_turn", usage: usage() });
    const env = testEnv({ PER_VISITOR_DAILY_LIMIT: "2" });

    const before = await worker.fetch(request("/quota", { method: "GET" }), env);
    expect(((await before.json()) as any).remaining).toBe(2);

    await worker.fetch(request("/extract", { body: { transcript: TRANSCRIPT } }), env);
    const after = await worker.fetch(request("/quota", { method: "GET" }), env);
    const afterJson = (await after.json()) as any;
    expect(afterJson.remaining).toBe(1);
    expect(afterJson.remaining).toBeGreaterThanOrEqual(0);
  });

  it("does not itself increment the visitor's count", async () => {
    mockTurnstileSuccess();
    parseMock.mockResolvedValue({ parsed_output: RECIPE, stop_reason: "end_turn", usage: usage() });
    const env = testEnv({ PER_VISITOR_DAILY_LIMIT: "1" });

    // Calling /quota repeatedly must not use up the one allowed /extract call.
    await worker.fetch(request("/quota", { method: "GET" }), env);
    await worker.fetch(request("/quota", { method: "GET" }), env);
    await worker.fetch(request("/quota", { method: "GET" }), env);

    const extractRes = await worker.fetch(request("/extract", { body: { transcript: TRANSCRIPT } }), env);
    expect(extractRes.status).toBe(200);
  });

  it("does not require a Turnstile token", async () => {
    const res = await worker.fetch(
      request("/quota", { method: "GET", headers: { "X-Turnstile-Token": "" } }),
      testEnv(),
    );
    expect(res.status).toBe(200);
  });

  it("answers GET preflight with CORS headers", async () => {
    const res = await worker.fetch(request("/quota", { method: "OPTIONS" }), testEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});

describe("fails closed on missing configuration", () => {
  it.each([
    ["missing VISITOR_SALT", { VISITOR_SALT: "" }],
    ["missing ANTHROPIC_API_KEY", { ANTHROPIC_API_KEY: undefined as unknown as string }],
    ["missing TURNSTILE_SECRET", { TURNSTILE_SECRET: "  " }],
    ["non-numeric DAILY_BUDGET_USD", { DAILY_BUDGET_USD: "half a dollar" }],
    ["missing PER_VISITOR_DAILY_LIMIT", { PER_VISITOR_DAILY_LIMIT: undefined as unknown as string }],
  ])("%s → refuses before calling Claude", async (_label, overrides) => {
    mockTurnstileSuccess();
    parseMock.mockClear();
    const res = await worker.fetch(
      request("/extract", { body: { transcript: TRANSCRIPT } }),
      testEnv(overrides as Partial<Env>),
    );
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(((await res.json()) as any).code).toBe("upstream_error");
    expect(parseMock).not.toHaveBeenCalled();
  });
});
