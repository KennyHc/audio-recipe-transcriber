#!/usr/bin/env bash
# Builds the signed-in web app (VITE_BACKEND=cloud) and publishes it to Cloudflare Pages
# (recipe-transcriber.pages.dev), replacing the anonymous hosted build.
#
#   VITE_API_BASE=https://api-<hash>.europe-west1.run.app npm run deploy:site:cloud
#
# The Firebase web config and App Check site key come from web/.env.cloud.local (written by
# scripts/gcp-setup.sh). They're public by design; the Anthropic key never goes here —
# it lives only in Secret Manager. build:cloud fails if the bundle contains a key.
# To switch back to the anonymous version, run `npm run deploy:site` (scripts/deploy-site.sh).
#
# Deploys from inside web/ so Pages picks up web/functions/ (r/[id].ts adds link-preview meta tags
# to public recipe pages; FIREBASE_PROJECT_ID can be set as a Pages env var, default
# recipe-transcriber-eu). build:cloud also fails if VITE_CONTACT_EMAIL is empty.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${VITE_API_BASE:?Set VITE_API_BASE to the Cloud Run API URL (https://...)}"
if [[ "$VITE_API_BASE" != https://* ]]; then
  echo "VITE_API_BASE must be an https:// URL for production (got: $VITE_API_BASE)" >&2; exit 1
fi
for var in VITE_FIREBASE_API_KEY VITE_FIREBASE_PROJECT_ID VITE_FIREBASE_APP_ID VITE_APPCHECK_SITE_KEY VITE_CONTACT_EMAIL; do
  grep -q "^$var=." web/.env.cloud.local 2>/dev/null \
    || { echo "web/.env.cloud.local is missing $var — run scripts/gcp-setup.sh" >&2; exit 1; }
done

# Exported values take priority over web/.env.cloud* (Vite never overrides existing env vars).
export VITE_API_BASE VITE_USE_EMULATORS=false
npm run build:cloud -w web

# Same as deploy-site.sh: the ~27 MB ONNX wasm loads from jsDelivr, not from Pages.
rm -f web/dist/assets/ort-wasm-*.wasm
oversized=$(find web/dist -type f -size +25M)
if [[ -n "$oversized" ]]; then echo "Files over the 25 MiB asset limit: $oversized" >&2; exit 1; fi
node_modules/.bin/tsc --noEmit -p web/functions
cd web
../node_modules/.bin/wrangler pages deploy dist --project-name recipe-transcriber --branch main --commit-dirty=true
