// The recipe's video/page link (cloud mode): asked for at upload (optional), sent with
// POST /recipes as `sourceUrl`, editable on the recipe page, and used to prefill Publish.
// Same limits as the contract (shared/cloud.ts: a URL ≤ 500 chars) and firebase/firestore.rules
// (an http(s) string ≤ 500 chars, or null).

import { normalizeUrl } from "./publish";

export const MAX_SOURCE_URL_LENGTH = 500;

export type SourceUrlResult = { ok: true; url: string | null } | { ok: false; error: string };

/**
 * What the field holds, ready to send: null for an empty field, a full https URL for a link
 * pasted without a scheme ("youtu.be/…"), or an error to show inline.
 */
export function parseSourceUrl(raw: string): SourceUrlResult {
  if (raw.trim() === "") return { ok: true, url: null };
  const url = normalizeUrl(raw);
  if (!url) return { ok: false, error: "That doesn't look like a web link — paste the video's address." };
  if (url.length > MAX_SOURCE_URL_LENGTH) return { ok: false, error: "That link is too long (500 characters max)." };
  return { ok: true, url };
}

/** The inline error for a (non-empty) link, or null when it's fine. */
export function sourceUrlProblem(raw: string): string | null {
  const r = parseSourceUrl(raw);
  return r.ok ? null : r.error;
}

/** "youtube.com/watch?v=…" — a short, readable form of the link for the recipe page. */
export function displaySourceUrl(url: string, max = 48): string {
  let text = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text;
}
