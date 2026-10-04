import {
  ExtractRequest,
  type ExtractResponse,
  TURNSTILE_HEADER,
  VerifyRequest,
  type VerifyResponse,
} from "@recipe/shared";
import { corsHeadersFor, parseAllowedOrigins } from "./cors";
import { actualCostUsd, estimateMaxCostUsd } from "./cost";
import {
  getLimiterStub,
  incrementVisitorOrThrow,
  releaseReservation,
  reserveOrThrow,
  settleReservation,
} from "./durableObjects/client";
import { LimiterDO } from "./durableObjects/limiter";
import { AppError, appError, sanitizedErrorLog, toErrorResponseParts } from "./errors";
import { EXTRACT_MAX_TOKENS, extractRecipe } from "./llm/extract";
import { VERIFY_MAX_TOKENS, verifyRecipe } from "./llm/verify";
import { utcDateString } from "./rollover";
import { verifyTurnstile } from "./turnstile";
import type { Env } from "./types";
import { assertTranscriptSizeOrThrow, parseBodyOrThrow, transcriptChars } from "./validation";
import { computeVisitorId } from "./visitorId";

export { LimiterDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const cors = corsHeadersFor(origin, allowedOrigins);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors ?? {} });
    }

    const url = new URL(request.url);
    const route = routeFor(request.method, url.pathname);
    if (!route) {
      return new Response("Not found", { status: 404, headers: cors ?? {} });
    }

    try {
      assertConfiguredOrThrow(env);
      const body =
        route === "extract" ? await handleExtract(env, request) : await handleVerify(env, request);
      return jsonResponse(200, body, cors);
    } catch (err) {
      const { status, body } = toErrorResponseParts(err);
      // Never log the request body (it may contain user audio transcripts)
      // and redact every live secret from the error text before printing it.
      console.error(
        "[worker]",
        sanitizedErrorLog(err, [env.ANTHROPIC_API_KEY, env.TURNSTILE_SECRET, env.VISITOR_SALT]),
      );
      return jsonResponse(status, body, cors);
    }
  },
};

/**
 * Fail closed: refuse to serve if a secret is missing or a limit isn't a valid number.
 * Otherwise a missing VISITOR_SALT would hash IPs with the literal "undefined", and a
 * missing/mistyped DAILY_BUDGET_USD would become NaN, which silently disables the cap.
 */
function assertConfiguredOrThrow(env: Env): void {
  const secretsOk = [env.ANTHROPIC_API_KEY, env.TURNSTILE_SECRET, env.VISITOR_SALT].every(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
  const budget = Number(env.DAILY_BUDGET_USD);
  const perVisitor = Number(env.PER_VISITOR_DAILY_LIMIT);
  const limitsOk =
    Number.isFinite(budget) && budget >= 0 && Number.isInteger(perVisitor) && perVisitor >= 0;
  if (!secretsOk || !limitsOk) {
    console.error("[worker] refusing request: missing secret or invalid limit configuration");
    throw appError("upstream_error");
  }
}

function routeFor(method: string, pathname: string): "extract" | "verify" | null {
  if (method !== "POST") return null;
  if (pathname === "/extract") return "extract";
  if (pathname === "/verify") return "verify";
  return null;
}

async function handleExtract(env: Env, request: Request): Promise<ExtractResponse> {
  const { transcript } = parseBodyOrThrow(ExtractRequest, await parseJsonOrThrow(request));
  assertTranscriptSizeOrThrow(transcript);
  await requireTurnstile(env, request);

  const stub = getLimiterStub(env.LIMITER);
  const now = new Date();
  const ip = clientIp(request);
  const visitorId = await computeVisitorId(ip, env.VISITOR_SALT, utcDateString(now));
  await incrementVisitorOrThrow(stub, visitorId, Number(env.PER_VISITOR_DAILY_LIMIT), now);

  const reserved = estimateMaxCostUsd(env.EXTRACTOR_MODEL, transcriptChars(transcript), EXTRACT_MAX_TOKENS);
  await reserveOrThrow(stub, reserved, Number(env.DAILY_BUDGET_USD), now);

  try {
    const { recipe, usage } = await extractRecipe(env.ANTHROPIC_API_KEY, env.EXTRACTOR_MODEL, transcript);
    await settleReservation(stub, reserved, actualCostUsd(env.EXTRACTOR_MODEL, usage), utcDateString(now));
    return { recipe };
  } catch (err) {
    await releaseReservation(stub, reserved, utcDateString(now));
    throw err;
  }
}

async function handleVerify(env: Env, request: Request): Promise<VerifyResponse> {
  const { transcript, recipe } = parseBodyOrThrow(VerifyRequest, await parseJsonOrThrow(request));
  assertTranscriptSizeOrThrow(transcript);
  await requireTurnstile(env, request);

  const stub = getLimiterStub(env.LIMITER);
  const now = new Date();

  const reserved = estimateMaxCostUsd(env.VERIFIER_MODEL, transcriptChars(transcript), VERIFY_MAX_TOKENS);
  await reserveOrThrow(stub, reserved, Number(env.DAILY_BUDGET_USD), now);

  try {
    const { warnings, usage } = await verifyRecipe(env.ANTHROPIC_API_KEY, env.VERIFIER_MODEL, transcript, recipe);
    await settleReservation(stub, reserved, actualCostUsd(env.VERIFIER_MODEL, usage), utcDateString(now));
    return { warnings };
  } catch (err) {
    await releaseReservation(stub, reserved, utcDateString(now));
    throw err;
  }
}

async function requireTurnstile(env: Env, request: Request): Promise<void> {
  const token = request.headers.get(TURNSTILE_HEADER);
  const ok = await verifyTurnstile(fetch, env.TURNSTILE_SECRET, token, clientIp(request));
  if (!ok) throw appError("bot_check_failed");
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

async function parseJsonOrThrow(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw appError("bad_request");
  }
}

function jsonResponse(status: number, body: unknown, cors: Record<string, string> | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(cors ?? {}) },
  });
}

// Re-exported for tests that want to assert on the AppError type directly.
export { AppError };
