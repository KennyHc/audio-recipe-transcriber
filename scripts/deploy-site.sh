#!/usr/bin/env bash
# Builds the hosted web app and publishes it as a static-assets Worker (web/wrangler.toml).
#
#   VITE_API_BASE=https://recipe-transcriber-api.<you>.workers.dev \
#   VITE_TURNSTILE_SITE_KEY=<your public Turnstile site key> \
#   npm run deploy:site
#
# Both values are public. The Anthropic key never goes here — it lives only in the
# Worker's Cloudflare secrets. build:hosted fails if the bundle contains a key.
set -euo pipefail

: "${VITE_API_BASE:?Set VITE_API_BASE to the deployed Worker URL (https://...)}"
: "${VITE_TURNSTILE_SITE_KEY:?Set VITE_TURNSTILE_SITE_KEY to your Turnstile site key}"

if [[ "$VITE_API_BASE" != https://* ]]; then
  echo "VITE_API_BASE must be an https:// URL for production (got: $VITE_API_BASE)" >&2; exit 1
fi
if [[ "$VITE_TURNSTILE_SITE_KEY" == 1x00000000000000000000AA || "$VITE_TURNSTILE_SITE_KEY" == 2x* || "$VITE_TURNSTILE_SITE_KEY" == 3x* ]]; then
  echo "VITE_TURNSTILE_SITE_KEY is a Cloudflare TEST key; use your real site key for production." >&2; exit 1
fi

# Exported values take priority over web/.env.hosted (Vite never overrides existing env vars).
export VITE_API_BASE VITE_TURNSTILE_SITE_KEY
npm run build:hosted -w web

# ONNX Runtime's WebAssembly binary (~27 MB) is over the 25 MiB per-file limit for
# Workers static assets. It's never served from here anyway: transformers.js points
# onnxruntime-web at the matching version on cdn.jsdelivr.net by default
# (node_modules/@huggingface/transformers/src/backends/onnx.js), so drop the copy Vite emits.
rm -f web/dist/assets/ort-wasm-*.wasm
oversized=$(find web/dist -type f -size +25M)
if [[ -n "$oversized" ]]; then echo "Files over the 25 MiB asset limit: $oversized" >&2; exit 1; fi
cd web && ../node_modules/.bin/wrangler deploy
