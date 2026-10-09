// Cloud mode: turning API failures (shared/cloud.ts CloudError codes) and Firestore errors into
// short, friendly messages. Pure — no Firebase imports — so it's unit-tested directly.

import { FREE_MONTHLY_RECIPES, MAX_TRANSCRIPT_CHARS, type CloudErrorCode } from "@recipe/shared";

/** API codes plus the two failures that never reach the API: no network, and a 2xx/4xx body we
 * couldn't read. */
export type CloudFailureCode = CloudErrorCode | "network" | "bad_response";

export class CloudApiError extends Error {
  constructor(
    readonly code: CloudFailureCode,
    /** Friendly, show-as-is. */
    message: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "CloudApiError";
  }
}

/** "November 1" (adds the year when it isn't this year). */
export function formatResetDate(date: Date, now: Date = new Date()): string {
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

/** The first instant of next UTC month — when the monthly allowance resets. */
export function nextMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function quotaExceededMessage(limit: number, resetsAt: Date, now: Date = new Date()): string {
  return `You've used your ${limit} free recipes this month. They reset on ${formatResetDate(resetsAt, now)}.`;
}

export interface FriendlyMessageContext {
  /** The API's own message (CloudError.error) — already safe to show; used where it's specific. */
  serverMessage?: string | null;
  retryAfterSeconds?: number | null;
  /** The account's monthly limit, if known (defaults to FREE_MONTHLY_RECIPES). */
  limit?: number;
  now?: Date;
}

export function friendlyCloudMessage(code: CloudFailureCode, ctx: FriendlyMessageContext = {}): string {
  const now = ctx.now ?? new Date();
  switch (code) {
    case "quota_exceeded": {
      const resetsAt =
        ctx.retryAfterSeconds != null && ctx.retryAfterSeconds > 0
          ? new Date(now.getTime() + ctx.retryAfterSeconds * 1000)
          : nextMonthStart(now);
      return quotaExceededMessage(ctx.limit ?? FREE_MONTHLY_RECIPES, resetsAt, now);
    }
    case "budget_exhausted":
      return "Recipe Transcriber has reached its daily limit for everyone. Please try again tomorrow — your transcript is saved, so Retry won't transcribe again.";
    case "unauthenticated":
      return "Your sign-in has expired. Sign in again, then press Retry.";
    case "app_check_failed":
      return "We couldn't verify this browser. Reload the page and try again.";
    case "not_found":
      return "Recipe not found.";
    case "too_large":
      return `This transcript is too long to turn into one recipe (max ${MAX_TRANSCRIPT_CHARS.toLocaleString("en-US")} characters). Try a shorter clip.`;
    case "upstream_error":
      return "Couldn't make a recipe from this transcript right now. Press Retry in a minute.";
    case "network":
      return "Couldn't reach Recipe Transcriber. Check your connection, then press Retry.";
    case "internal":
    case "bad_response":
      return "Something went wrong on our side. Please try again.";
    case "conflict":
    case "bad_request":
    default:
      return ctx.serverMessage?.trim() || "Something went wrong. Please try again.";
  }
}

/** Firestore's FirestoreError codes we treat specially (kept as strings so this file needs no
 * Firebase import). Reading a recipe that doesn't exist — or isn't yours — is "permission-denied"
 * under firebase/firestore.rules (the read rule checks resource.data.ownerId), not "not-found". */
export function friendlyFirestoreMessage(err: unknown, what: "recipe" | "transcript" | "version" = "recipe"): string {
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
  switch (code) {
    case "permission-denied":
    case "not-found":
      return what === "transcript" ? "Transcript not available." : what === "version" ? "Version not found." : "Recipe not found.";
    case "unavailable":
      return "You're offline — reconnect to load your recipes.";
    case "unauthenticated":
      return "Sign in to see your recipes.";
    case "failed-precondition":
    case "aborted":
      return "This recipe changed on another device. Reload and try again.";
    default:
      return err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.";
  }
}
