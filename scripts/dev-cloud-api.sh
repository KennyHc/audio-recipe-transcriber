#!/usr/bin/env bash
# Local dev: the Cloud Run API against the Firebase emulators (npm run emulators -w firebase-config).
# Takes ANTHROPIC_API_KEY from the repo's .env (never printed); without it Claude calls fail
# with upstream_error and everything else still works.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${ANTHROPIC_API_KEY:-}" && -f .env ]]; then
  ANTHROPIC_API_KEY="$(grep -E '^ANTHROPIC_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
fi
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-missing}"
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export GCLOUD_PROJECT=demo-recipe REQUIRE_APP_CHECK=false PORT="${PORT:-8080}"
export EXTRACTOR_MODEL="${EXTRACTOR_MODEL:-claude-haiku-4-5}" VERIFIER_MODEL="${VERIFIER_MODEL:-claude-haiku-4-5}"
exec npm run dev -w api
