const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Verifies a Turnstile token server-side. `fetchFn` is injected so this is
 * testable without a real network call; in production callers pass the
 * ambient `fetch`.
 */
export async function verifyTurnstile(
  fetchFn: FetchFn,
  secret: string,
  token: string | null,
  remoteIp: string | null,
): Promise<boolean> {
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  let response: Response;
  try {
    response = await fetchFn(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    return false;
  }

  if (!response.ok) return false;
  const data = (await response.json().catch(() => null)) as { success?: boolean } | null;
  return data?.success === true;
}
