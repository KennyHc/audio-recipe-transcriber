// Link previews for public recipe pages (/r/{id}). Pure — no DOM, no Workers types — so it's
// shared by the Cloudflare Pages Function (web/functions/r/[id].ts) and unit-tested with vitest.
//
// The function reads publicRecipes/{id} unauthenticated through the Firestore REST API (the rules
// allow reading live docs by id), turns the typed REST JSON into the few fields a preview needs,
// and injects Open Graph / Twitter tags into index.html. Everything is HTML-escaped.

export const DEFAULT_FIREBASE_PROJECT_ID = "recipe-transcriber-eu";
export const SITE_NAME = "Recipe Transcriber";

export function firestoreDocUrl(projectId: string, publicId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/publicRecipes/${encodeURIComponent(publicId)}`;
}

/** Ids are our recipe ids (CreateRecipeRequest: [A-Za-z0-9_-]{8,64}); anything else isn't looked up. */
export function isPlausibleId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

type FirestoreValue = Record<string, unknown>;

/** Firestore REST typed value → plain JS ({stringValue:"x"} → "x", mapValue → object, …). */
export function fromFirestoreValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return null;
  const v = value as FirestoreValue;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return Boolean(v.booleanValue);
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) {
    const values = (v.arrayValue as { values?: unknown[] } | undefined)?.values ?? [];
    return values.map(fromFirestoreValue);
  }
  if ("mapValue" in v) return fromFirestoreFields((v.mapValue as { fields?: Record<string, unknown> } | undefined)?.fields);
  return null;
}

export function fromFirestoreFields(fields: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(fields ?? {})) out[k] = fromFirestoreValue(val);
  return out;
}

export interface PreviewInfo {
  title: string;
  description: string | null;
  channelName: string | null;
  handle: string | null;
  thumbnailUrl: string | null;
  ingredientCount: number;
  visibility: "public" | "unlisted";
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** The preview fields of a LIVE public recipe from a Firestore REST document, else null. */
export function previewFromFirestoreDoc(doc: unknown): PreviewInfo | null {
  if (!doc || typeof doc !== "object") return null;
  const data = fromFirestoreFields((doc as { fields?: Record<string, unknown> }).fields);
  if (data.status !== "live") return null;
  const recipe = (data.recipe ?? {}) as Record<string, unknown>;
  const source = (data.source ?? {}) as Record<string, unknown>;
  const title = str(recipe.title);
  if (!title) return null;
  const thumb = str(source.thumbnailUrl);
  return {
    title,
    description: str(recipe.description),
    channelName: source.kind === "own" ? null : str(source.channelName),
    handle: str(data.handle),
    thumbnailUrl: thumb && /^https:\/\//i.test(thumb) ? thumb : null,
    ingredientCount: Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0,
    visibility: data.visibility === "unlisted" ? "unlisted" : "public",
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export interface MetaTag {
  attr: "property" | "name";
  key: string;
  content: string;
}

/** "Recipe by {channel} · {n} ingredients" (or "by @handle" when there's no channel). */
export function previewDescription(info: PreviewInfo): string {
  const by = info.channelName ? `Recipe by ${info.channelName}` : info.handle ? `Recipe by @${info.handle}` : "Recipe";
  const n = info.ingredientCount;
  return `${by} · ${n} ingredient${n === 1 ? "" : "s"}`;
}

export function buildPreviewMeta(info: PreviewInfo, pageUrl: string): { title: string; tags: MetaTag[] } {
  const title = clip(info.title, 120);
  const description = clip(previewDescription(info), 200);
  const tags: MetaTag[] = [
    { attr: "property", key: "og:type", content: "article" },
    { attr: "property", key: "og:site_name", content: SITE_NAME },
    { attr: "property", key: "og:title", content: title },
    { attr: "property", key: "og:description", content: description },
    { attr: "property", key: "og:url", content: pageUrl },
    { attr: "name", key: "description", content: description },
    { attr: "name", key: "twitter:card", content: info.thumbnailUrl ? "summary_large_image" : "summary" },
    { attr: "name", key: "twitter:title", content: title },
    { attr: "name", key: "twitter:description", content: description },
  ];
  if (info.thumbnailUrl) {
    tags.push({ attr: "property", key: "og:image", content: info.thumbnailUrl });
    tags.push({ attr: "name", key: "twitter:image", content: info.thumbnailUrl });
  }
  if (info.visibility === "unlisted") tags.push({ attr: "name", key: "robots", content: "noindex" });
  return { title: `${title} · ${SITE_NAME}`, tags };
}

/** The tags as HTML for <head>, every value escaped. */
export function renderMetaTags(tags: MetaTag[]): string {
  return tags.map((t) => `<meta ${t.attr}="${escapeHtml(t.key)}" content="${escapeHtml(t.content)}" />`).join("\n");
}

/** Canonical page URL for og:url — origin + /r/{id}, dropping any query/hash. */
export function canonicalPageUrl(requestUrl: string, publicId: string): string {
  const u = new URL(requestUrl);
  return `${u.origin}/r/${encodeURIComponent(publicId)}`;
}
