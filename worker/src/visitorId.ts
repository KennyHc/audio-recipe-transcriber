/**
 * Derives an anonymous per-visitor id for rate limiting. Never store or log
 * the raw IP — only this hash, which also rolls over at UTC midnight because
 * `date` is part of the digest input.
 */
export async function computeVisitorId(ip: string, salt: string, utcDate: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}:${salt}:${utcDate}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
