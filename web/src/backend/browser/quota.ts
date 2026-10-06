import { QuotaResponse } from "@recipe/shared";

// Hosted mode only: today's free-recipe allowance from the Worker's GET /quota (shared/proxy.ts).
// Read-only and unauthenticated (no Turnstile token needed). The UI must never break because
// quota is unavailable, so every failure (network, non-2xx, bad JSON, schema mismatch) resolves
// to null rather than throwing — callers treat null as "don't show a quota line".

function apiBase(): string | null {
  const base = import.meta.env.VITE_API_BASE;
  return base ? base.replace(/\/+$/, "") : null;
}

export async function fetchQuota(): Promise<QuotaResponse | null> {
  const base = apiBase();
  if (!base) return null;

  let response: Response;
  try {
    response = await fetch(`${base}/quota`, { method: "GET" });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const parsed = QuotaResponse.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
