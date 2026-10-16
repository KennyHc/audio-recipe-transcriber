// The sitemap lives on the canonical host (Firebase Hosting → the API's GET /sitemap.xml);
// on pages.dev, send crawlers there instead of serving the app's index.html.
import { CANONICAL_ORIGIN } from "../src/lib/previewMeta";

export const onRequestGet: PagesFunction = async () =>
  Response.redirect(`${CANONICAL_ORIGIN}/sitemap.xml`, 301);
