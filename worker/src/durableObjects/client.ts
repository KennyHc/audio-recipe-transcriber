import { appError } from "../errors";
import { buildLimiterRequest, type LimiterRequest, type LimiterResponse } from "./protocol";

const INSTANCE_NAME = "global";

export function getLimiterStub(namespace: DurableObjectNamespace): DurableObjectStub {
  const id = namespace.idFromName(INSTANCE_NAME);
  return namespace.get(id);
}

async function call(stub: DurableObjectStub, body: LimiterRequest): Promise<LimiterResponse> {
  const response = await stub.fetch(buildLimiterRequest(body));
  return (await response.json()) as LimiterResponse;
}

/** Throws `rate_limited` if this visitor has used today's /extract allowance. */
export async function incrementVisitorOrThrow(
  stub: DurableObjectStub,
  visitorId: string,
  limit: number,
  now: Date,
): Promise<void> {
  const result = await call(stub, { action: "incrementVisitor", visitorId, limit, nowMs: now.getTime() });
  if (!result.ok) throw appError("rate_limited", result.retryAfterSeconds);
}

/** Throws `budget_exhausted` if reserving `amountUsd` would exceed today's cap. */
export async function reserveOrThrow(
  stub: DurableObjectStub,
  amountUsd: number,
  budgetUsd: number,
  now: Date,
): Promise<void> {
  const result = await call(stub, { action: "reserve", amountUsd, budgetUsd, nowMs: now.getTime() });
  if (!result.ok) throw appError("budget_exhausted", result.retryAfterSeconds);
}

export async function releaseReservation(stub: DurableObjectStub, amountUsd: number): Promise<void> {
  await call(stub, { action: "release", amountUsd });
}

export async function settleReservation(
  stub: DurableObjectStub,
  reservedAmountUsd: number,
  actualAmountUsd: number,
): Promise<void> {
  await call(stub, { action: "settle", reservedAmountUsd, actualAmountUsd });
}
