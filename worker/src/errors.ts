import type { ProxyError, ProxyErrorCode } from "@recipe/shared";

/** Thrown anywhere in the request pipeline to produce a specific ProxyError response. */
export class AppError extends Error {
  readonly code: ProxyErrorCode;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(code: ProxyErrorCode, status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const GENERIC_MESSAGES: Record<ProxyErrorCode, string> = {
  bad_request: "That request wasn't formatted the way we expected.",
  too_large: "This transcript is too long to process.",
  bot_check_failed: "We couldn't verify you're not a bot — please retry.",
  rate_limited: "You've used today's allowance — try again tomorrow.",
  budget_exhausted: "The recipe service is at its daily usage cap — try again tomorrow.",
  upstream_error: "The recipe service had a problem — please try again.",
};

const STATUS_FOR_CODE: Record<ProxyErrorCode, number> = {
  bad_request: 400,
  too_large: 413,
  bot_check_failed: 403,
  rate_limited: 429,
  budget_exhausted: 503,
  upstream_error: 502,
};

export function appError(code: ProxyErrorCode, retryAfterSeconds: number | null = null): AppError {
  return new AppError(code, STATUS_FOR_CODE[code], GENERIC_MESSAGES[code], retryAfterSeconds);
}

/**
 * Converts any thrown error into a safe { status, body } pair. Never includes
 * the original error's message for anything not already an AppError — that
 * message may come from the Anthropic SDK and, in pathological cases
 * (misconfigured client, provider-side echo), could contain the API key.
 */
export function toErrorResponseParts(err: unknown): { status: number; body: ProxyError } {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: { error: GENERIC_MESSAGES[err.code], code: err.code, retryAfterSeconds: err.retryAfterSeconds },
    };
  }
  return {
    status: STATUS_FOR_CODE.upstream_error,
    body: { error: GENERIC_MESSAGES.upstream_error, code: "upstream_error", retryAfterSeconds: null },
  };
}

/**
 * A log line safe to print for an unexpected error: the error's name/message
 * with any substring matching an active secret redacted. Call sites pass the
 * live secret values so this works even if an SDK error message happens to
 * echo part of a request (e.g. an Authorization header) back.
 */
export function sanitizedErrorLog(err: unknown, secrets: string[]): string {
  let text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  for (const secret of secrets) {
    if (!secret) continue;
    text = text.split(secret).join("[redacted]");
  }
  return text;
}
