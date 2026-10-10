/**
 * GET /r/:id — link previews for public recipe pages on Firebase Hosting (web.app), which
 * rewrites /r/** here (firebase/firebase.json). Same job as the Cloudflare Pages Function
 * (web/functions/r/[id].ts) and the same shared builder (shared/previewMeta.ts): serve the
 * site's index.html with Open Graph / Twitter tags for a LIVE recipe, or unchanged otherwise.
 *
 * No auth (crawlers fetch this). index.html comes from the Hosting site itself (/index.html is
 * a real file there, not rewritten, so no loop) and is cached in memory briefly.
 */
import { PUBLIC_COLLECTIONS } from "@recipe/shared";
import {
  buildPreviewMeta,
  injectPreviewIntoHtml,
  isPlausibleId,
  previewFromPublicDoc,
} from "@recipe/shared/previewMeta";
import type { Firestore } from "firebase-admin/firestore";
import type { FetchLike } from "./sources";

const INDEX_TTL_MS = 5 * 60_000;
const INDEX_TIMEOUT_MS = 4000;

export interface PreviewDeps {
  db: Firestore;
  fetch: FetchLike;
  siteOrigin: string; // e.g. https://recipe-transcriber-eu.web.app
  now: () => Date;
}

let cachedIndex: { html: string; at: number; origin: string } | null = null;

/** For tests. */
export function resetIndexCache(): void {
  cachedIndex = null;
}

async function loadIndexHtml(deps: PreviewDeps): Promise<string | null> {
  const now = deps.now().getTime();
  if (cachedIndex && cachedIndex.origin === deps.siteOrigin && now - cachedIndex.at < INDEX_TTL_MS) {
    return cachedIndex.html;
  }
  try {
    const res = await deps.fetch(`${deps.siteOrigin}/index.html`, { signal: AbortSignal.timeout(INDEX_TIMEOUT_MS) });
    if (!res.ok) return cachedIndex?.html ?? null;
    const html = await res.text();
    cachedIndex = { html, at: now, origin: deps.siteOrigin };
    return html;
  } catch {
    return cachedIndex?.html ?? null; // a stale page beats no page
  }
}

/** The HTML to serve for /r/{id}, or null if the site's index.html can't be fetched at all. */
export async function previewPage(deps: PreviewDeps, id: string): Promise<string | null> {
  const html = await loadIndexHtml(deps);
  if (html === null) return null;
  if (!isPlausibleId(id)) return html;
  try {
    const snap = await deps.db.collection(PUBLIC_COLLECTIONS.publicRecipes).doc(id).get();
    const info = previewFromPublicDoc(snap.data());
    if (!info) return html;
    const meta = buildPreviewMeta(info, `${deps.siteOrigin}/r/${encodeURIComponent(id)}`);
    return injectPreviewIntoHtml(html, meta);
  } catch {
    return html;
  }
}
