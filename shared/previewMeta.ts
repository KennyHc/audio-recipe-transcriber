// Link previews for public recipe pages (/r/{id}). Pure — no DOM, no Workers types — so it's
// shared by the Cloudflare Pages Function (web/functions/r/[id].ts), the API (GET /r/:id, which
// Firebase Hosting rewrites to for web.app), and unit-tested with vitest.
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
  return previewFromPublicDoc(fromFirestoreFields((doc as { fields?: Record<string, unknown> }).fields));
}

/** The same from a plain publicRecipes doc (e.g. read with firebase-admin), else null. */
export function previewFromPublicDoc(data: Record<string, unknown> | undefined): PreviewInfo | null {
  if (!data || data.status !== "live") return null;
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

/**
 * The homepage's own preview tags (web/index.html) that a recipe page must replace, not add
 * to — crawlers take the FIRST og:title/og:image they see.
 */
export function isReplacedPreviewTag(attr: "property" | "name", key: string): boolean {
  return (
    (attr === "property" && key.startsWith("og:")) ||
    (attr === "name" && (key.startsWith("twitter:") || key === "description"))
  );
}

const PREVIEW_META_TAG = /<meta\s+(property|name)="([^"]+)"[^>]*>\s*/gi;

/**
 * String version of the Pages Function's HTMLRewriter step, for Node (the API's GET /r/:id):
 * removes the homepage's preview tags, replaces <title>, and appends the recipe's tags (plus
 * `extraHead`, e.g. recipeHeadExtras) just before </head>.
 */
export function injectPreviewIntoHtml(
  html: string,
  meta: { title: string; tags: MetaTag[] },
  extraHead = "",
): string {
  const withoutHomepageTags = html.replace(PREVIEW_META_TAG, (tag, attr: string, key: string) =>
    isReplacedPreviewTag(attr.toLowerCase() as "property" | "name", key.toLowerCase()) ? "" : tag,
  );
  const withTitle = withoutHomepageTags.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`);
  const i = withTitle.search(/<\/head>/i);
  if (i === -1) return withTitle;
  const head = extraHead ? `${renderMetaTags(meta.tags)}\n${extraHead}` : renderMetaTags(meta.tags);
  return `${withTitle.slice(0, i)}${head}\n${withTitle.slice(i)}`;
}

// ---------------------------------------------------------------------------
// Search engines: canonical URL + schema.org Recipe (Google recipe rich results)
// ---------------------------------------------------------------------------

/** One canonical home for every public page, whichever host served it (pages.dev or web.app). */
export const CANONICAL_ORIGIN = "https://recipe-transcriber-eu.web.app";

export function canonicalRecipeUrl(publicId: string): string {
  return `${CANONICAL_ORIGIN}/r/${encodeURIComponent(publicId)}`;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "2 cloves garlic, minced" from a stored ingredient. */
function ingredientLine(ing: Record<string, unknown>): string | null {
  const item = str(ing.item);
  if (!item) return null;
  const q = num(ing.quantity);
  const qty = q === null ? null : Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100);
  const prep = str(ing.prep);
  return [qty, str(ing.unit), item].filter(Boolean).join(" ") + (prep ? `, ${prep}` : "");
}

/**
 * schema.org Recipe for a LIVE public recipe doc (plain object: firebase-admin data, or the
 * Firestore REST doc via fromFirestoreFields), else null. Only what the recipe actually says:
 * no invented ratings, times, or nutrition.
 */
export function buildRecipeJsonLd(data: Record<string, unknown> | undefined, publicId: string): Record<string, unknown> | null {
  if (!data || data.status !== "live") return null;
  const recipe = (data.recipe ?? {}) as Record<string, unknown>;
  const source = (data.source ?? {}) as Record<string, unknown>;
  const name = str(recipe.title);
  if (!name) return null;

  const ingredients = (Array.isArray(recipe.ingredients) ? recipe.ingredients : [])
    .map((i) => ingredientLine((i ?? {}) as Record<string, unknown>))
    .filter((l): l is string => l !== null);
  const steps = (Array.isArray(recipe.steps) ? recipe.steps : [])
    .map((st) => str(((st ?? {}) as Record<string, unknown>).text))
    .filter((t): t is string => t !== null)
    .map((text) => ({ "@type": "HowToStep", text }));

  const channel = source.kind === "own" ? null : str(source.channelName);
  const handle = str(data.handle);
  const thumb = str(source.thumbnailUrl);
  const minutes = num(recipe.totalTimeMinutes);
  const servings = num(recipe.servings);
  const tags = Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === "string") : [];

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name,
    url: canonicalRecipeUrl(publicId),
    author: channel
      ? { "@type": "Person", name: channel, ...(str(source.channelUrl) ? { url: str(source.channelUrl) } : {}) }
      : { "@type": "Person", name: handle ? `@${handle}` : SITE_NAME },
    recipeIngredient: ingredients,
    recipeInstructions: steps,
  };
  const description = str(recipe.description);
  if (description) ld.description = description;
  if (thumb && /^https:\/\//i.test(thumb)) ld.image = [thumb];
  if (minutes !== null && minutes > 0) ld.totalTime = `PT${Math.round(minutes)}M`;
  if (servings !== null && servings > 0) ld.recipeYield = `${servings} servings`;
  if (tags.length) ld.keywords = tags.join(", ");
  const published = str(data.publishedAt);
  if (published) ld.datePublished = published.slice(0, 10);
  const original = str(source.url);
  if (original && /^https?:\/\//i.test(original)) ld.isBasedOn = original;
  return ld;
}

/** JSON for a <script> body: "<" escaped so recipe text can never close the tag. */
export function jsonLdScript(ld: Record<string, unknown>): string {
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;
}

/** Everything a live recipe page adds to <head> beyond the meta tags. */
export function recipeHeadExtras(data: Record<string, unknown> | undefined, publicId: string): string {
  const ld = buildRecipeJsonLd(data, publicId);
  const canonical = `<link rel="canonical" href="${escapeHtml(canonicalRecipeUrl(publicId))}" />`;
  return ld ? `${canonical}\n${jsonLdScript(ld)}` : canonical;
}
