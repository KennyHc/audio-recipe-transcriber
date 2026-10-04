/** Internal fetch-based RPC contract between the Worker and the LimiterDO instance. */

export type LimiterRequest =
  | { action: "incrementVisitor"; visitorId: string; limit: number; nowMs: number }
  | { action: "reserve"; amountUsd: number; budgetUsd: number; nowMs: number }
  // `day` is the UTC date the reservation was made on: release/settle must hit that day's
  // counter, not "today", or a call that crosses midnight would corrupt the new day's budget.
  | { action: "release"; amountUsd: number; day: string }
  | { action: "settle"; reservedAmountUsd: number; actualAmountUsd: number; day: string };

export type LimiterResponse = { ok: true } | { ok: false; retryAfterSeconds: number };

/** Builds the internal Request sent to the Durable Object's fetch handler. */
export function buildLimiterRequest(body: LimiterRequest): Request {
  // The URL is never actually routed on (the DO only has one fetch handler) —
  // Durable Object fetch still requires a well-formed Request with a URL.
  return new Request("https://limiter.internal/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
