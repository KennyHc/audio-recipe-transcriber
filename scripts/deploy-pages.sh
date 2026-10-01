#!/usr/bin/env bash
# Builds the hosted web app and publishes it to Cloudflare Pages.
#
#   VITE_API_BASE=https://recipe-transcriber-api.<you>.workers.dev \
#   VITE_TURNSTILE_SITE_KEY=<your public Turnstile site key> \
#   npm run deploy:pages
#
# Both values are public. The Anthropic key never goes here — it lives only in the
# Worker's Cloudflare secrets. build:hosted fails if the bundle contains a key.
set -euo pipefail

: "${VITE_API_BASE:?Set VITE_API_BASE to the deployed Worker URL (https://...)}"
: "${VITE_TURNSTILE_SITE_KEY:?Set VITE_TURNSTILE_SITE_KEY to your Turnstile site key}"
PROJECT="${PAGES_PROJECT:-recipe-transcriber}"

if [[ "$VITE_API_BASE" != https://* ]]; then
  echo "VITE_API_BASE must be an https:// URL for production (got: $VITE_API_BASE)" >&2; exit 1
fi
if [[ "$VITE_TURNSTILE_SITE_KEY" == 1x00000000000000000000AA || "$VITE_TURNSTILE_SITE_KEY" == 2x* || "$VITE_TURNSTILE_SITE_KEY" == 3x* ]]; then
  echo "VITE_TURNSTILE_SITE_KEY is a Cloudflare TEST key; use your real site key for production." >&2; exit 1
fi

# Exported values take priority over web/.env.hosted (Vite never overrides existing env vars).
export VITE_API_BASE VITE_TURNSTILE_SITE_KEY
npm run build:hosted -w web
npx --prefix worker wrangler pages deploy web/dist --project-name "$PROJECT" --branch main
