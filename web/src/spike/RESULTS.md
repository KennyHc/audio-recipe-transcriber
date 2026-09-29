# Whisper-in-browser spike results

Spike page: `web/whisper-spike.html` + `web/src/spike/*`. Not part of the app — throwaway.

Test clip: the default `egg-fried-rice` job audio (`/api/jobs/oGJ7cuzG07uDn4uMNn-mM/audio`),
a real 7.6-minute (456.5s) YouTube cooking video, same clip used for
`eval/cases/egg-fried-rice`. All runs used the Browser pane (Chromium) on macOS, WebGPU
available (`navigator.gpu` present), so every run used `device: "webgpu"`.

## Metrics

| Model | dtype | Device | Model load (first run, incl. download) | Transcribe wall time | Real-time factor (audio s / processing s) |
|---|---|---|---|---|---|
| Xenova/whisper-base | q8 | webgpu | 8.8s | 161.5s | 2.83x |
| Xenova/whisper-small | q8 | webgpu | 66.6s | 445.5s | 1.02x |
| onnx-community/whisper-large-v3-turbo | q4 | webgpu | 18.9s | 70.8s | 6.45x |

Notes on load time: these are first-run (cold cache) numbers except that whisper-base's
files were already warm in the browser's HTTP cache from an earlier throwaway run (load
was 8.8s where a genuinely cold load would be higher — comparable to small's 66.6s scaled
by download size). large-v3-turbo's 18.9s at q4 reflects a much smaller download
(quantized encoder+decoder, a few hundred MB) than fp32, which is the point of using q4.
A second run of any model (browser HTTP cache warm, no server involved) should load in a
few seconds regardless of size — did not measure separately, out of scope for this spike.

**Anomaly worth flagging**: the spike page's status log originally did an unbounded
`statusEl.textContent += line` on every download-progress tick. For large-v3-turbo's
many small onnx files this produced enough DOM churn to genuinely hang the tab's main
thread (confirmed: even `1+1` in the page's console stopped responding for 60+ seconds).
Fixed by keeping a bounded ring buffer and batching renders via `requestAnimationFrame`
(`web/src/spike/main.ts`). This is a spike-page bug, not a transformers.js/Whisper issue,
but it's a real trap: naive progress-UI code that appends per-chunk network progress to
the DOM will hang the page on a real device once the log gets long enough, especially for
larger models with more onnx shards. A production implementation must throttle/aggregate
progress UI updates.

## Word error rate vs. the existing large-model (whisper.cpp) reference transcript

Reference: `eval/cases/egg-fried-rice/transcript.json` (whisper.cpp large model,
server-side). Computed with `web/src/spike/wer.mjs` — lowercase, strip punctuation,
Levenshtein word alignment.

| Model | WER vs. server-side large reference |
|---|---|
| Xenova/whisper-base (q8) | 42.28% (474 edits / 1121 ref words) |
| Xenova/whisper-small (q8) | 33.18% (372 edits / 1121 ref words) |
| onnx-community/whisper-large-v3-turbo (q4) | 23.19% (260 edits / 1121 ref words) |

These numbers are inflated relative to "real" WER because the reference and hypotheses
differ in more than just recognition errors: different chunking/segmentation boundaries,
spelling of the host's name ("Seonkyoung" vs "Sangkyung" vs "Sungkyung" — all three
in-browser models mangle it differently), and (for whisper-base especially) outright
hallucinated repetition loops at the end of the clip during near-silence/music (see
below). Still, the *relative ordering* is the useful signal: base < small < large-v3-turbo
in accuracy, matching expectations from model size.

### Qualitative observations

- **whisper-base**: noticeably worse. Repeats digits nonsensically around 0:57-1:05
  ("Two. Two. Three. Two. Three...", not actually said), duplicates a whole sentence
  around 1:44 ("The eggs are beaten... they need beautiful in fried rice" appears twice
  with slightly different wording), and outputs a long garbage run of repeated "-8"
  tokens around 2:26-3:07 where the reference has real words about oil. At the very end
  (outro music, no speech) it goes into an unbounded hallucination loop, repeating
  "[OUTRO MUSIC PLAYING]" continuously for the rest of the transcribe call — a classic
  Whisper failure mode on silence/music with no timestamp-forced decoding. This alone
  would make base's output unusable without post-processing (dedup/repetition removal).
- **whisper-small**: much more coherent, still has some duplicated/looped phrases (e.g.
  "camera... egg sardine... green onion sardine" — a stretch of nonsense around 1:42-1:51,
  and one clearly duplicated line at the chili-sauce moment ~4:55-5:05, matching the
  eval case's noted "duplicated 2 tbsp oil" risk in a different spot). No runaway
  hallucination loop at the end.
- **whisper-large-v3-turbo (q4)**: cleanest of the three, no repetition loops, good
  handling of the chili-oil aside and the ending small-talk section. Still not perfect
  (a garbled stretch around 4:49-4:55: "Also was bigger than mine because he's a
  pop-key..." — background chatter that's genuinely hard to make out even for a human).
  It correctly stops at "Music" x4 at the very end instead of hallucinating a loop.

## Files added

- `web/whisper-spike.html` — the spike page (added as a second Vite build entry).
- `web/src/spike/main.ts` — page logic: model/dtype selection, audio loading, worker
  orchestration, transcript rendering, JSON download, `window.__spikeResult`.
- `web/src/spike/whisper.worker.ts` — Web Worker running the transformers.js
  `automatic-speech-recognition` pipeline (keeps the UI thread free).
- `web/src/spike/audio.ts` — Web Audio API decode + `OfflineAudioContext` resample to
  16kHz mono `Float32Array`. No ffmpeg.
- `web/src/spike/models.ts` — candidate model list with dtypes verified to exist on the
  Hub (see comments in the file for the exact API calls used to verify).
- `web/src/spike/transcript.ts` — local copy of the `Transcript` shape (spike must not
  import from `shared/`).
- `web/src/spike/wer.mjs` — standalone Node WER calculator, no dependencies.
- `eval/cases/egg-fried-rice-browser-whisper-base/{transcript,expected}.json`
- `eval/cases/egg-fried-rice-browser-whisper-small/{transcript,expected}.json`
- `eval/cases/egg-fried-rice-browser-whisper-large-v3-turbo/{transcript,expected}.json`
  (`expected.json` copied verbatim from `eval/cases/egg-fried-rice/expected.json` per
  the task — same rubric, not re-authored.)
- `web/vite.config.ts` — added `whisper-spike.html` as a second `build.rollupOptions.input`
  entry so `vite build` produces it (dev server already serves any `.html` file at its
  path with no config).

## Recommendation

**Use `onnx-community/whisper-large-v3-turbo` at `q4` (falling back to `q4f16` if q4
proves numerically unstable on some GPUs) as the default in-browser model**, with WebGPU
preferred and WASM as fallback:

- It was the *fastest* of the three (6.45x real-time) despite being the "large" model —
  the turbo variant's small decoder is the reason, and this matches upstream benchmarks.
  A 7.6-minute clip transcribed in ~71 seconds; a typical 2-4 minute recipe clip would
  take well under a minute.
- It had the best accuracy by a clear margin (23% vs 33% vs 42% WER against the
  reference) and, critically, did not exhibit the repetition/hallucination failure modes
  that make whisper-base's output unusable without extra cleanup.
- The q4 download (~a few hundred MB) stayed comfortably under the 1.5GB budget and loaded
  in under 20s on this connection; whisper-small's fp32/q8 download was slower to load
  (66.6s) *and* far slower to run (445.5s, ~1x realtime) *and* less accurate — worse on
  every axis than large-v3-turbo here, so there's no real "small is a good middle
  ground" case for this app based on this test.
- Caveat: this was one clip, one machine, one GPU, and WebGPU was available. Devices
  without WebGPU fall back to WASM, which will be substantially slower (untested here —
  worth a follow-up spike run with `device: "wasm"` forced, since some users' browsers/
  GPUs won't support WebGPU). Also worth testing a shorter/noisier clip and a
  non-English clip before committing, since large-v3-turbo's relative advantage over
  small could shrink on easier audio.
- Given the base model's hallucination-loop behavior on trailing music/silence, whichever
  model ships should also get `condition_on_previous_text`-style safeguards or a
  post-processing repetition filter regardless of which model is chosen — this is a
  known Whisper failure mode, not specific to the browser port.
