# Short-term functional improvements

Two passes: a broad brainstorm grounded in what real use and the evals showed, then a critique
that cut weak or risky ideas and ranked the rest. Nothing here is implemented yet.
"Short term" = each item is S (≤ half a day) or M (1–2 days).

## Ranked list (after pass 2)

| # | Improvement | Why (evidence) | Size |
|---|---|---|---|
| 1 | **Edit the transcript, then re-extract** | Whisper misheard "four green onions" as "all green onions" on a real clip; today the only fix is editing the recipe by hand. Letting users correct the transcript (with click-to-hear on each segment, which already exists) fixes the source and re-runs extraction — saved as a new version. | M |
| 2 | **Scale and convert quantities inside step text** | The servings scaler and Metric/Imperial toggle change the ingredient list but not steps ("add two tablespoons of soy sauce" stays at 2 tbsp when scaled ×2). Show scaled/converted numbers inline in steps (and cook mode), keeping the original on hover. | M |
| 3 | **Back up / restore the library** | Hosted and in-browser modes keep everything in IndexedDB; clearing site data or switching browsers loses every recipe. Export all recipes + versions (+ optionally audio) to one file and import it back. | S |
| 4 | **Show the remaining free recipes** | Visitors only learn about the 20/day limit when they hit it. The Worker already counts per visitor — return the remaining count and show "17 of 20 free recipes left today" near the upload zone. | S |
| 5 | **Pick the speech model per device** | The 762 MB model is a lot for phones. Use `navigator.deviceMemory`, WebGPU availability, and `connection.saveData` to pre-select small on weak/mobile devices (user can still choose) and say why in the dialog. | S |
| 6 | **Privacy-safe error reporting** | The Hugging Face block was only found because the user pasted console logs. Send error codes + stage + browser/WebGPU facts (no transcripts, no audio) to the Worker, log them, and update the privacy page. | S |
| 7 | **"Report a problem with this recipe"** | Real failures are the best eval cases. A button that, with explicit consent, sends the transcript + recipe to a review queue (or downloads a bundle the user can email) — feeds `eval/cases/`. | M |
| 8 | **Resolve warnings** | Warnings stay forever even after the cook checks them. "Looks right" on a warning removes it in a new version (keeps history), so the "N things to double-check" count goes down. | S |
| 9 | **Cancel a running job** | Long clips can't be stopped once transcription starts (only by closing the tab). Add Cancel for queued/transcribing jobs (terminate the worker) and keep the audio for a later Retry. | S |
| 10 | **Background timer alerts in cook mode** | Timers chime only while the tab is visible; cooks switch apps. Use the Notification API (ask once, on first timer start) to alert when a timer ends in the background. | S |
| 11 | **Library basics: search, rename, sort** | Fine with 2 recipes; unusable with 30. Client-side search over titles/ingredients, inline rename (new version), sort by date/title. | S |
| 12 | **Paste a transcript or captions instead of audio** | Many videos already have captions; pasting text skips the 300–760 MB model entirely (great on phones) and costs nothing extra. Parses plain text or .srt/.vtt (keeps timestamps). | S |
| 13 | **Detect multiple dishes in one clip** | The extractor assumes one recipe; a class covering two dishes would merge them. Ask the extractor to flag "multiple recipes detected" and let the user pick which one (or split into two jobs). | M |

## Pass 1 ideas that were cut, and why

- **Import from a YouTube/TikTok link** — the most requested kind of feature, but downloading
  platform audio conflicts with their terms and needs a server; item 12 (paste captions)
  covers much of the need without that.
- **Voice control in cook mode ("next step")** — delightful, but browser speech recognition
  is inconsistent across browsers and would send audio to third parties; revisit later.
- **Shopping list across recipes** — valuable, but larger than "short term" once units,
  merging duplicates, and scaling are done properly; do after item 2 (which it depends on).
- **Nutrition estimates** — would add a second source of possibly-wrong numbers; off-brand
  for a tool whose promise is "only what was said, with warnings for the rest".
- **Offline PWA / installable app** — the first load and Claude still need the network; the
  model is already cached. Worth it later for cook mode, not now.
- **Auto-running evals in CI on every prompt change** — costs API credits on every push;
  better as a manual `npm run eval` before prompt changes (already possible).

## Suggested order

1. Quick wins that build trust and protect users' work: **3, 4, 6, 9** (all S).
2. Accuracy where users notice it most: **1, 2**.
3. Cooking flow polish: **10, 8, 11**.
4. Growth/quality loop: **7, 12, 5, 13**.
