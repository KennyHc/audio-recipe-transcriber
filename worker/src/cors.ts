/** Pure CORS decision logic — no Request/Response types, easy to unit test. */

export const ALLOWED_REQUEST_HEADERS = "Content-Type, X-Turnstile-Token";
export const ALLOWED_METHODS = "POST, OPTIONS";

export function parseAllowedOrigins(allowedOriginsVar: string): string[] {
  return allowedOriginsVar
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

export function isOriginAllowed(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

/** Headers to add when `origin` is an allowed origin; null means "do not add CORS headers". */
export function corsHeadersFor(
  origin: string | null,
  allowedOrigins: string[],
): Record<string, string> | null {
  if (!isOriginAllowed(origin, allowedOrigins)) return null;
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_REQUEST_HEADERS,
    Vary: "Origin",
  };
}
