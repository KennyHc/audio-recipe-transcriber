// Cloudflare Pages Function for /r/{id} — the public recipe page. Link-preview crawlers
// (WhatsApp, iMessage, Slack…) don't run the app, so this adds Open Graph / Twitter tags to
// index.html for live public recipes. Everything else (missing, not live, Firestore down) gets
// index.html unchanged and the app shows its own page.
//
// Reads publicRecipes/{id} unauthenticated via the Firestore REST API (firebase/firestore.rules
// allow reading a live public recipe by id). Project id: env FIREBASE_PROJECT_ID, default below.

import {
  DEFAULT_FIREBASE_PROJECT_ID,
  buildPreviewMeta,
  canonicalPageUrl,
  isReplacedPreviewTag,
  firestoreDocUrl,
  isPlausibleId,
  previewFromFirestoreDoc,
  renderMetaTags,
  type PreviewInfo,
} from "../../src/lib/previewMeta";

interface Env {
  ASSETS: Fetcher;
  FIREBASE_PROJECT_ID?: string;
}

const FIRESTORE_TIMEOUT_MS = 2500;

async function loadPreview(env: Env, id: string): Promise<PreviewInfo | null> {
  if (!isPlausibleId(id)) return null;
  const projectId = env.FIREBASE_PROJECT_ID?.trim() || DEFAULT_FIREBASE_PROJECT_ID;
  try {
    const res = await fetch(firestoreDocUrl(projectId, id), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FIRESTORE_TIMEOUT_MS),
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!res.ok) return null; // 403 (not live), 404 (missing), …
    return previewFromFirestoreDoc(await res.json());
  } catch {
    return null;
  }
}

export const onRequestGet: PagesFunction<Env, "id"> = async (context) => {
  const { request, env, params } = context;
  const id = Array.isArray(params.id) ? params.id[0] ?? "" : params.id;

  const indexResponse = await env.ASSETS.fetch(new URL("/", request.url).toString());
  const info = indexResponse.ok ? await loadPreview(env, id) : null;
  if (!info) return indexResponse;

  const meta = buildPreviewMeta(info, canonicalPageUrl(request.url, id));
  const rewritten = new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(meta.title); // text, escaped by HTMLRewriter
      },
    })
    // Drop the homepage's own preview tags (web/index.html) so crawlers see only the recipe's.
    .on("meta", {
      element(el) {
        const property = el.getAttribute("property");
        const name = el.getAttribute("name");
        if (
          (property && isReplacedPreviewTag("property", property.toLowerCase())) ||
          (name && isReplacedPreviewTag("name", name.toLowerCase()))
        ) {
          el.remove();
        }
      },
    })
    .on("head", {
      element(el) {
        el.append(renderMetaTags(meta.tags), { html: true }); // values escaped in renderMetaTags
      },
    })
    .transform(indexResponse);

  const headers = new Headers(rewritten.headers);
  headers.set("Cache-Control", "public, max-age=0, s-maxage=60");
  return new Response(rewritten.body, { status: 200, headers });
};
