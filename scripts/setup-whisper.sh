#!/usr/bin/env bash
# Downloads a whisper.cpp model into ./models (default: large-v3-turbo, ~1.6 GB).
# Usage: npm run setup:whisper [-- <model-name>]   e.g. small.en (~470 MB)
set -euo pipefail
MODEL="${1:-large-v3-turbo}"
mkdir -p models
DEST="models/ggml-${MODEL}.bin"
if [ -f "$DEST" ]; then echo "Already have $DEST"; exit 0; fi
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin"
echo "Downloading $URL -> $DEST"
# Download to .part and rename only when complete, so an interrupted download
# (e.g. disk full) never leaves a truncated model that looks "already there".
# -C - resumes a previous partial download.
curl -L --fail -C - -o "$DEST.part" "$URL"
mv "$DEST.part" "$DEST"
echo "Done. Set WHISPER_MODEL=./$DEST in .env"
