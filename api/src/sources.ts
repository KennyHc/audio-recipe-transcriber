/**
 * Source resolution for publishing (Phase 2): turns a pasted link into
 * { platform, videoId, canonical url } and, for YouTube/TikTok, fetches the credit from the
 * platform's oEmbed endpoint so it can't be typed wrong.
 *
 * SSRF: the only URLs this server ever fetches are the two fixed oEmbed endpoints and TikTok
 * short-link redirects (each hop must stay on a TikTok host). User links on any other site
 * are only parsed and stored, never fetched — and even then non-http(s) schemes,
 * credentials, and private/loopback/link-local hosts are refused, because the link is later
 * rendered as an <a href> on the public page.
 */
import {
  PUBLIC_COLLECTIONS,
  PublicRecipeDoc,
  type SourcePlatform,
  type SourcePreview,
  sourceKey,
} from "@recipe/shared";
import type { Firestore } from "firebase-admin/firestore";
import { appError } from "./errors";

/** The subset of fetch we use; injectable so tests never touch the network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const SOURCE_FETCH_TIMEOUT_MS = 5000;
export const MAX_SOURCE_URL_CHARS = 500;
const MAX_SHORT_LINK_HOPS = 3;

export interface ResolvedLink {
  platform: SourcePlatform;
  /** youtube/tiktok only. */
  videoId: string | null;
  /** Canonical link to the original. */
  url: string;
}

export interface SourceCredit {
  title: string | null;
  channelName: string | null;
  channelUrl: string | null;
  thumbnailUrl: string | null;
}

/** What parseSourceUrl recognises before any network call. */
export type ParsedLink = ResolvedLink | { platform: "tiktok-short"; videoId: null; url: string };

const INVALID_LINK = "That link isn't a valid public web address.";
const NOT_A_VIDEO = "That link doesn't point to a single video.";

// ---------------------------------------------------------------------------
// Pure parsing
// ---------------------------------------------------------------------------

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TIKTOK_ID = /^\d{5,30}$/;
const TIKTOK_USER = /^@[A-Za-z0-9._]{1,40}$/;

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

const isUnder = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

function isYouTubeHost(host: string): boolean {
  return isUnder(host, "youtube.com") || isUnder(host, "youtu.be") || isUnder(host, "youtube-nocookie.com");
}

function isTikTokHost(host: string): boolean {
  return isUnder(host, "tiktok.com");
}

function isTikTokShortLink(host: string, url: URL): boolean {
  return host === "vm.tiktok.com" || host === "vt.tiktok.com" || (isTikTokHost(host) && /^\/t\/[A-Za-z0-9]+\/?$/.test(url.pathname));
}

/**
 * Parses and vets a user-supplied link. Throws 400 bad_request for anything that isn't a
 * public http(s) URL, and 422 source_unavailable for a YouTube/TikTok link that isn't one
 * video. Never does I/O.
 */
export function parseSourceUrl(raw: string): ParsedLink {
  if (raw.length > MAX_SOURCE_URL_CHARS) throw appError("bad_request", null, INVALID_LINK);
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw appError("bad_request", null, INVALID_LINK);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw appError("bad_request", null, INVALID_LINK);
  if (url.username || url.password) throw appError("bad_request", null, INVALID_LINK);
  const host = hostOf(url);
  if (isDisallowedHost(host)) throw appError("bad_request", null, INVALID_LINK);

  if (isYouTubeHost(host)) {
    const id = youTubeId(host, url);
    if (!id) throw appError("source_unavailable", null, NOT_A_VIDEO);
    return { platform: "youtube", videoId: id, url: `https://www.youtube.com/watch?v=${id}` };
  }

  if (isTikTokHost(host)) {
    if (isTikTokShortLink(host, url)) {
      return { platform: "tiktok-short", videoId: null, url: `https://${host}${url.pathname}` };
    }
    const video = tikTokVideo(url);
    if (!video) throw appError("source_unavailable", null, NOT_A_VIDEO);
    return { platform: "tiktok", videoId: video.id, url: `https://www.tiktok.com/${video.user}/video/${video.id}` };
  }

  url.hash = "";
  return { platform: "other", videoId: null, url: url.toString() };
}

function youTubeId(host: string, url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  let candidate: string | null | undefined = null;
  if (isUnder(host, "youtu.be")) {
    candidate = segments[0];
  } else if (segments[0] === "watch") {
    candidate = url.searchParams.get("v");
  } else if (segments[0] && ["shorts", "embed", "live", "v"].includes(segments[0])) {
    candidate = segments[1];
  }
  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
}

function tikTokVideo(url: URL): { user: string; id: string } | null {
  const [user, kind, id] = url.pathname.split("/").filter(Boolean);
  if (!user || !id || kind !== "video") return null;
  const decodedUser = decodeURIComponent(user);
  if (!TIKTOK_USER.test(decodedUser) || !TIKTOK_ID.test(id)) return null;
  return { user: decodedUser, id };
}

/**
 * True for hosts we refuse to link to (or fetch): localhost and other local names,
 * single-label names, private/loopback/link-local/CGNAT/multicast IPv4, and any IPv6
 * literal outside global unicast (2000::/3) — which also covers ::1, fc00::/7, fe80::/10,
 * and IPv4-mapped addresses. The WHATWG URL parser has already normalised odd IPv4 forms
 * (e.g. "0x7f.1", "2130706433") to dotted quads.
 */
export function isDisallowedHost(hostname: string): boolean {
  let h = hostname.toLowerCase().replace(/\.$/, "");
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (!h) return true;
  if (h.includes(":")) return !isGlobalUnicastV6(h);
  const v4 = parseIPv4(h);
  if (v4) return isPrivateV4(v4);
  if (!h.includes(".")) return true; // "localhost", "metadata", intranet names
  return ["localhost", "local", "internal", "home.arpa", "lan", "intranet"].some((suffix) => isUnder(h, suffix));
}

function parseIPv4(h: string): number[] | null {
  const parts = h.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const nums = parts.map(Number);
  return nums.every((n) => n <= 255) ? nums : null;
}

function isPrivateV4([a, b]: number[]): boolean {
  if (a === undefined || b === undefined) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

function isGlobalUnicastV6(h: string): boolean {
  const first = h.split(":")[0];
  if (!first) return false; // "::…" — unspecified, loopback, IPv4-mapped/compatible
  const value = Number.parseInt(first, 16);
  return Number.isFinite(value) && value >= 0x2000 && value <= 0x3fff;
}

// ---------------------------------------------------------------------------
// Network: TikTok short links + oEmbed (only these are ever fetched)
// ---------------------------------------------------------------------------

function fetchWithTimeout(fetchFn: FetchLike, url: string, init: RequestInit = {}): Promise<Response> {
  return fetchFn(url, {
    ...init,
    signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json", "User-Agent": "RecipeTranscriber/1.0 (+https://recipe-transcriber.pages.dev)" },
  });
}

function platformName(platform: "youtube" | "tiktok"): string {
  return platform === "youtube" ? "YouTube" : "TikTok";
}

/** Follows a vm/vt.tiktok.com (or tiktok.com/t/…) link to the full video URL. */
export async function resolveTikTokShortLink(fetchFn: FetchLike, shortUrl: string): Promise<ResolvedLink> {
  let current = shortUrl;
  for (let hop = 0; hop < MAX_SHORT_LINK_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetchWithTimeout(fetchFn, current, { method: "GET", redirect: "manual" });
    } catch {
      throw appError("upstream_error", null, "We couldn't reach TikTok to look up that link — please try again.");
    }
    await res.body?.cancel().catch(() => {});
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) throw appError("source_unavailable", null, NOT_A_VIDEO);

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw appError("source_unavailable", null, NOT_A_VIDEO);
    }
    const host = hostOf(next);
    // Each hop must stay on TikTok over http(s); anything else is never fetched.
    if ((next.protocol !== "https:" && next.protocol !== "http:") || !isTikTokHost(host)) {
      throw appError("source_unavailable", null, NOT_A_VIDEO);
    }
    if (isTikTokShortLink(host, next)) {
      current = `https://${host}${next.pathname}`;
      continue;
    }
    const video = tikTokVideo(next);
    if (!video) throw appError("source_unavailable", null, NOT_A_VIDEO);
    return { platform: "tiktok", videoId: video.id, url: `https://www.tiktok.com/${video.user}/video/${video.id}` };
  }
  throw appError("source_unavailable", null, NOT_A_VIDEO);
}

export async function resolveLink(fetchFn: FetchLike, raw: string): Promise<ResolvedLink> {
  const parsed = parseSourceUrl(raw);
  if (parsed.platform === "tiktok-short") return resolveTikTokShortLink(fetchFn, parsed.url);
  return parsed;
}

export function oEmbedEndpoint(platform: "youtube" | "tiktok", canonicalUrl: string): string {
  const q = encodeURIComponent(canonicalUrl);
  return platform === "youtube"
    ? `https://www.youtube.com/oembed?url=${q}&format=json`
    : `https://www.tiktok.com/oembed?url=${q}`;
}

/** Looks up the credit for a YouTube/TikTok video. 4xx → 422 source_unavailable. */
export async function fetchOEmbed(
  fetchFn: FetchLike,
  platform: "youtube" | "tiktok",
  canonicalUrl: string,
): Promise<SourceCredit> {
  const unreachable = `We couldn't reach ${platformName(platform)} to look up that video — please try again.`;
  let res: Response;
  try {
    res = await fetchWithTimeout(fetchFn, oEmbedEndpoint(platform, canonicalUrl), { method: "GET" });
  } catch {
    throw appError("upstream_error", null, unreachable);
  }
  if ([400, 401, 403, 404].includes(res.status)) {
    await res.body?.cancel().catch(() => {});
    throw appError(
      "source_unavailable",
      null,
      `We couldn't look up that ${platformName(platform)} video — it may be private, removed, or not embeddable.`,
    );
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw appError("upstream_error", null, unreachable);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw appError("upstream_error", null, unreachable);
  }
  return mapOEmbed(data);
}

/** oEmbed JSON → credit. Defensive: wrong types become null; links must be http(s). */
export function mapOEmbed(data: unknown): SourceCredit {
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return {
    title: text(o.title, 300),
    channelName: text(o.author_name, 200),
    channelUrl: webUrl(o.author_url),
    thumbnailUrl: webUrl(o.thumbnail_url),
  };
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

function webUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Resolve + credit. For "other" links the credit is all null (the creator types a name). */
export async function lookupSource(
  fetchFn: FetchLike,
  raw: string,
): Promise<{ link: ResolvedLink; credit: SourceCredit }> {
  const link = await resolveLink(fetchFn, raw);
  if (link.platform === "other") {
    return { link, credit: { title: null, channelName: null, channelUrl: null, thumbnailUrl: null } };
  }
  return { link, credit: await fetchOEmbed(fetchFn, link.platform, link.url) };
}

// ---------------------------------------------------------------------------
// Duplicate lookup + GET /sources/preview
// ---------------------------------------------------------------------------

export function sourceRef(db: Firestore, platform: string, videoId: string) {
  return db.collection(PUBLIC_COLLECTIONS.sources).doc(sourceKey(platform, videoId));
}

/** The live, public recipe already claiming this video, if any. */
export async function existingLivePublicId(
  db: Firestore,
  link: ResolvedLink,
): Promise<string | null> {
  if (link.platform === "other" || !link.videoId) return null;
  const mapping = await sourceRef(db, link.platform, link.videoId).get();
  const id = (mapping.data() as { publicRecipeId?: unknown } | undefined)?.publicRecipeId;
  if (typeof id !== "string") return null;
  const snap = await db.collection(PUBLIC_COLLECTIONS.publicRecipes).doc(id).get();
  return isLivePublic(snap.data()) ? id : null;
}

export function isLivePublic(data: unknown): boolean {
  const parsed = PublicRecipeDoc.pick({ status: true, visibility: true }).safeParse(data);
  return parsed.success && parsed.data.status === "live" && parsed.data.visibility === "public";
}

export async function previewSource(db: Firestore, fetchFn: FetchLike, raw: string): Promise<SourcePreview> {
  const { link, credit } = await lookupSource(fetchFn, raw);
  return {
    platform: link.platform,
    videoId: link.videoId,
    url: link.url,
    ...credit,
    existingPublicId: await existingLivePublicId(db, link),
  };
}
