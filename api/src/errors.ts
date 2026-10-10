import type { CloudError, CloudErrorCode } from "@recipe/shared";

/** Thrown anywhere in the request pipeline to produce a specific CloudError response. */
export class AppError extends Error {
  readonly code: CloudErrorCode;
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  /** Overrides the generic message; must be user-safe (never SDK/library text). */
  readonly userMessage: string;

  /** Only with code "duplicate_video": the existing public recipe for that video. */
  readonly existingPublicId: string | null;

  constructor(
    code: CloudErrorCode,
    retryAfterSeconds: number | null = null,
    userMessage?: string,
    existingPublicId: string | null = null,
  ) {
    super(userMessage ?? GENERIC_MESSAGES[code]);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
    this.retryAfterSeconds = retryAfterSeconds;
    this.userMessage = userMessage ?? GENERIC_MESSAGES[code];
    this.existingPublicId = existingPublicId;
  }
}

export const GENERIC_MESSAGES: Record<CloudErrorCode, string> = {
  bad_request: "That request wasn't formatted the way we expected.",
  unauthenticated: "Please sign in again.",
  app_check_failed: "We couldn't verify this app — please reload the page and retry.",
  not_found: "That recipe wasn't found.",
  conflict: "That request conflicts with the recipe's current state.",
  too_large: "This transcript is too long to process.",
  quota_exceeded: "You've used this month's recipes — your allowance resets at the start of next month.",
  budget_exhausted: "The recipe service is at its daily usage cap — try again tomorrow.",
  upstream_error: "The recipe service had a problem — please try again.",
  internal: "Something went wrong on our side — please try again.",
  forbidden: "You don't have access to that.",
  rate_limited: "You've done that a lot today — please try again tomorrow.",
  handle_taken: "That handle is already taken — please pick another.",
  duplicate_video: "This video already has a public recipe.",
  source_unavailable: "We couldn't look up that video — it may be private, removed, or not a single video.",
};

const STATUS_FOR_CODE: Record<CloudErrorCode, number> = {
  bad_request: 400,
  unauthenticated: 401,
  app_check_failed: 401,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  quota_exceeded: 429,
  budget_exhausted: 503,
  upstream_error: 502,
  internal: 500,
  forbidden: 403,
  rate_limited: 429,
  handle_taken: 409,
  duplicate_video: 409,
  source_unavailable: 422,
};

export function appError(code: CloudErrorCode, retryAfterSeconds: number | null = null, userMessage?: string): AppError {
  return new AppError(code, retryAfterSeconds, userMessage);
}

/** 409 duplicate_video carrying the public recipe the client should offer instead. */
export function duplicateVideoError(existingPublicId: string): AppError {
  return new AppError("duplicate_video", null, undefined, existingPublicId);
}

/**
 * Converts any thrown error into a safe { status, body } pair. Anything that isn't an
 * AppError becomes a generic "internal" error: its message may come from the Anthropic or
 * Firebase SDK and could echo request details (or, pathologically, a credential).
 */
export function toErrorResponseParts(err: unknown): { status: number; body: CloudError } {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: {
        error: err.userMessage,
        code: err.code,
        retryAfterSeconds: err.retryAfterSeconds,
        ...(err.code === "duplicate_video" ? { existingPublicId: err.existingPublicId } : {}),
      },
    };
  }
  return {
    status: STATUS_FOR_CODE.internal,
    body: { error: GENERIC_MESSAGES.internal, code: "internal", retryAfterSeconds: null },
  };
}

// JWT-shaped strings (ID / App Check tokens) and Anthropic-style keys, redacted from logs
// even when we don't hold the exact value (e.g. a token echoed in a library error).
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const ANTHROPIC_KEY_PATTERN = /\bsk-ant-[A-Za-z0-9_-]+/g;

/**
 * A log-safe description of an unexpected error: name/message (plus a gRPC/Firebase code
 * if present) with every live secret and anything token-shaped redacted.
 */
export function sanitizedErrorLog(err: unknown, secrets: string[]): string {
  let text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" || typeof code === "number") text += ` (code ${String(code)})`;
  for (const secret of secrets) {
    if (!secret) continue;
    text = text.split(secret).join("[redacted]");
  }
  return text.replace(JWT_PATTERN, "[redacted-token]").replace(ANTHROPIC_KEY_PATTERN, "[redacted-key]");
}
