/**
 * GET /sitemap.xml (Firebase Hosting rewrites it here): every live public recipe page and
 * creator page, so search engines can find what the single-page app only renders in the
 * browser. Unlisted, in-review, and hidden recipes are never listed.
 */
import { PUBLIC_COLLECTIONS } from "@recipe/shared";
import { CANONICAL_ORIGIN } from "@recipe/shared/previewMeta";
import type { Firestore } from "firebase-admin/firestore";

/** Google's limit is 50k URLs per sitemap; far beyond what we need for now. */
const MAX_RECIPES = 5000;

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export interface SitemapEntry {
  loc: string;
  lastmod: string | null; // YYYY-MM-DD
}

export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => `  <url><loc>${xmlEscape(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export async function sitemapXml(db: Firestore): Promise<string> {
  const snap = await db
    .collection(PUBLIC_COLLECTIONS.publicRecipes)
    .where("status", "==", "live")
    .where("visibility", "==", "public")
    .orderBy("publishedAt", "desc")
    .select("updatedAt", "handle")
    .limit(MAX_RECIPES)
    .get();

  const entries: SitemapEntry[] = [{ loc: `${CANONICAL_ORIGIN}/`, lastmod: null }];
  const creators = new Map<string, string>(); // handle → newest updatedAt
  for (const doc of snap.docs) {
    const updatedAt = typeof doc.get("updatedAt") === "string" ? (doc.get("updatedAt") as string).slice(0, 10) : null;
    entries.push({ loc: `${CANONICAL_ORIGIN}/r/${encodeURIComponent(doc.id)}`, lastmod: updatedAt });
    const handle = doc.get("handle");
    if (typeof handle === "string" && handle && !creators.has(handle)) creators.set(handle, updatedAt ?? "");
  }
  for (const [handle, lastmod] of creators) {
    entries.push({ loc: `${CANONICAL_ORIGIN}/@${encodeURIComponent(handle)}`, lastmod: lastmod || null });
  }
  return renderSitemap(entries);
}
