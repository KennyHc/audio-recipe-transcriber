# Plan: optional cloud transcription

Status: **plan only — not built.** Written 2026-10-17. Build it if the launch stats show phone
visitors dropping off at the speech-model download (Admin → Stats: visits vs. recipes created,
and how often `captions_used` is the way people get a recipe).

## Why

Today Whisper runs in the browser: private and free to run, but a 300–760 MB first download,
the small (less accurate) model on phones, and jobs that restart if a phone suspends the tab.
A GPU in our own EU cloud runs the large model on a 7-minute clip in ~10–20 s, needs no
download, and keeps working when the tab is closed.

**Principle: private by default, fast when you choose it.** On-device stays the default
wherever it works well; cloud transcription is an explicit opt-in per upload, suggested on
phones and devices without WebGPU. The audio is deleted as soon as it's transcribed.

## What people see

1. Upload a clip → a choice under the drop zone (remembered per device):
   - **On this device** — private, free, needs the one-time model download *(default on
     computers with WebGPU)*.
   - **Fast, in the cloud** — "Your audio is sent to our server in the EU, transcribed, and
     deleted right away." *(suggested on phones and devices without WebGPU)*.
2. Cloud path progress: Uploading 0–100% → Waiting for the transcription server (first use in
   a while: "starting up, usually under a minute") → Transcribing → Extracting → Done.
3. **They can close the tab** after the upload finishes: the recipe appears in their library
   when ready (on any device). Click-to-hear still works on the uploading device (a local copy
   of the audio is kept in the browser, as today).
4. Limits shown up front: up to 20 minutes per clip; cloud minutes per month (see Decisions).

## Architecture (all in europe-west1 / eur3)

```
browser ── POST /transcriptions ─────────► api (Cloud Run)
   │           ← signed upload URL            │ creates transcriptions/{id}, counts quota
   ├── PUT audio (resumable) ─► GCS bucket recipe-transcriber-eu-uploads
   │                                (uniform access, no public access, lifecycle: delete after 1 day)
   └── POST /transcriptions/:id/start ─► api ─► Cloud Tasks queue ─► transcriber (Cloud Run + L4 GPU)
                                                                    │ private ingress, OIDC only
                 Firestore transcriptions/{id} ◄── status/progress ──┤ downloads audio, ffmpeg → 16 kHz
                 (owner can read, nobody writes)                     │ faster-whisper large-v3-turbo
                                                                    │ deletes the audio object
                                     api /internal/transcriptions/:id/complete ◄─┘ (OIDC from the
                                     runs extract + verify (existing pipeline),       transcriber SA)
                                     saves the recipe exactly like POST /recipes
```

- **transcriber** service (new, Python): `faster-whisper` (CTranslate2) with
  `large-v3-turbo`, int8_float16 on an NVIDIA L4; VAD filter on; word-level timestamps off
  (segment timestamps are what the app uses). Model weights baked into the image (~1.6 GB) so a
  cold start doesn't download them. `--gpu 1 --gpu-type nvidia-l4 --no-gpu-zonal-redundancy`,
  concurrency 1, min instances 0, max instances 2, timeout 15 min. No public ingress; only the
  Cloud Tasks service account can invoke it.
- **Why server-side completion:** the API chains extraction itself, so closing the tab can't
  strand a transcript; quota and budget logic stay in one place (`createRecipe`).
- **Why Cloud Tasks:** retries with backoff, rate limiting (max 2 concurrent → bounds GPU
  cost), and requests longer than a browser connection.
- **Why not a third-party API (Groq/OpenAI):** audio would leave the EU and add a new data
  processor. Groq (~0.5¢ per 7-min clip) is the fallback if the GPU quota or cold starts turn
  out to be a problem — the API boundary (`transcriptions/{id}`) stays the same.

## Data, contract, rules

`shared/cloudTranscription.ts` (new):
- `POST /transcriptions` `{ id, fileName, sizeBytes, contentType, durationSeconds, sourceUrl? }`
  → `{ uploadUrl, expiresAt }` — 20 min / 200 MB caps, allowed audio types only, counts toward
  the monthly recipe quota *and* cloud minutes (refunded on failure).
- `POST /transcriptions/:id/start` → 202 (enqueues the task once the object exists).
- `transcriptions/{id}`: `ownerId, status (uploading|queued|starting|transcribing|extracting|done|error),
  durationSeconds, error, createdAt, updatedAt, recipeId` — rules: owner read, no client writes.
- Recipe gets `source: "cloud"` in its version note (or a field) for support/debugging.
- Users doc: `usage.cloudMinutes` (same monthly rollover as `recipesCreated`).
- Global: `system/gpu-{date}` seconds counter → daily GPU budget (like the Claude budget).

## Security and privacy

- Signed URL bound to `uploads/{uid}/{id}`, content type, and
  `x-goog-content-length-range: 0,200MB`; valid 15 minutes.
- The transcriber re-checks the file with ffprobe (real audio, ≤ 20 min) before running the
  model; anything else fails the job without spending GPU time.
- Audio is deleted by the transcriber immediately after transcription (success *or* failure);
  the bucket's 1-day lifecycle rule is the backstop. Transcripts follow today's rules (owner
  only, deleted with the recipe/account). Nothing is used for training.
- Privacy page + Terms: what's uploaded, where (EU), how long (minutes), who processes it (us
  only), and that on-device remains available.
- `DELETE /me` also deletes any pending uploads and `transcriptions/*` of the user.

## Costs (estimates — check the Cloud Run GPU pricing page before building)

Cloud Run with an L4 GPU is roughly **$0.70–0.90 per hour** while an instance is up (GPU + CPU
+ memory), billed per second, scaling to zero.

| | Per 7-min clip | Launch (1k cloud clips/mo) | Growing (20k/mo) |
|---|---|---|---|
| GPU time, warm (~20 s) | ~0.5¢ | ~$5 | ~$100 |
| Cold starts (~45 s, when idle) | ~1¢ each | ~$5–10 | small share |
| Storage / egress / Tasks | ≈ 0 | < $1 | ~$2 |
| **Total** | **~0.5–1.5¢** | **~$10–15** | **~$100–120** |

Compare: Claude is ~1.5¢ per recipe, so cloud transcription roughly doubles the cost of a
cloud-made recipe at worst. Guard rails: per-user cloud minutes, daily GPU-seconds budget, max
2 instances, and a billing alert at the existing $20 budget (raise when this ships).

## Work plan (~1 week)

1. **Infra (½ day, needs you):** request Cloud Run GPU quota for L4 in europe-west1 (it starts
   at 0 for new projects; approval can take a day or two — do this first); create the bucket +
   lifecycle rule, Cloud Tasks queue, service accounts.
2. **Transcriber service (1½ days):** Dockerfile (CUDA base + faster-whisper + model baked
   in), `/transcribe` handler, ffprobe validation, progress writes, audio deletion, OIDC call
   to the API. Deploy script like `deploy-api.sh`.
3. **Contract, rules, API (1½ days):** routes above, quota + cloud minutes + GPU budget,
   `/internal/.../complete` (OIDC-verified), DELETE /me cleanup, emulator tests.
4. **Web (1½ days):** the choice under the drop zone (device-aware suggestion), resumable
   upload with progress, Firestore-driven status (works after closing the tab), Privacy/Terms
   text, Stats beacon `cloud_transcription_used`.
5. **Evaluate + roll out (1 day):** run the eval cases (`eval/cases/*`) through the cloud path
   and compare WER with the in-browser runs (we measured 23.9% for browser-small on the
   egg-fried-rice clip); measure cold/warm latency; ship behind an admin-only flag first, then
   to everyone.

## Decisions to make before building

1. **Free cloud minutes per month** — e.g. 60 min (≈ 8 recipes) on top of the 30-recipe quota,
   or simply count cloud recipes within the same 30?
2. **Default on phones** — pre-select "Fast, in the cloud" on phones (recommended) or always
   ask?
3. **Keep audio for re-transcription?** Recommended **no** (delete immediately) — re-extract
   already works from the saved transcript.
4. **Fallback provider** — accept Groq as a temporary fallback if GPU quota is delayed, or
   wait for the EU GPU?
