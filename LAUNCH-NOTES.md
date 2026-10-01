# Launch notes: what to do as real users arrive

A running list of things deliberately deferred while launching. Live today:

- Site: https://recipe-transcriber.pages.dev (Cloudflare Pages, `npm run deploy:site`)
- API: https://recipe-transcriber-api.kennyjiaxi.workers.dev (Worker, `npm run deploy:worker`)
- Limits: 20 recipes/visitor/day, $0.50/day global budget, Claude Haiku 4.5 (see DEPLOY.md)

## Before sharing the link widely

- [ ] **Self-host the speech models on Cloudflare R2** (free tier: 10 GB, free egress) and serve
      them from the site's own origin (`/models/*` via a Worker route with Range support).
      Why: today the browser downloads from Hugging Face, which can rate-limit or block us —
      it already rejects any request whose Referer is a `*.workers.dev` site (that's why the
      site is on pages.dev). Same-origin also removes CORS from the picture. Check the licence
      of the exact onnx-community files before uploading (Whisper itself is MIT).
- [ ] **Anthropic Console: $10/month spend limit** on the Default workspace — confirm it's set.
      The Worker's $0.50/day cap is the first line; the Console limit is the hard backstop.
- [ ] **Usage alerts**: Console email alerts at e.g. 50% / 80% of the monthly limit.
- [ ] **Privacy note / terms page**: audio stays on the device; transcripts go to our Worker and
      Anthropic; local data can be deleted in Settings. Needed before strangers use it.
- [ ] **Retire the old workers.dev site** (`recipe-transcriber.kennyjiaxi.workers.dev`): it's
      still deployed but can't download models. Replace it with a redirect to pages.dev, or
      delete it (`npx wrangler delete --name recipe-transcriber` — ask first).
- [ ] **Push the code somewhere**: `feat/initial-app` only exists on this Mac. Add a GitHub
      remote, merge to `main`, and add CI (typecheck + tests + `build:hosted` secret scan).

## When usage grows

- [ ] **Custom domain** (≈$10/yr): nicer link; add it to the Turnstile widget hostnames and to
      `ALLOWED_ORIGINS` in worker/wrangler.toml.
- [ ] **Revisit limits**: per-visitor 20/day and $0.50/day budget. Watch `npx wrangler tail`
      and Console usage; raise the budget deliberately, never remove it.
- [ ] **Error reporting**: client-side errors only reach the user today. Add lightweight
      reporting (no transcripts, no audio) so failures like the Hugging Face block are seen
      without a user having to paste console logs.
- [ ] **Cost per recipe dashboard**: the Worker settles actual cost per call — log daily totals.
- [ ] **Abuse review**: Turnstile + per-visitor hash + global budget are the current controls.
      If the budget is hit daily, consider sign-in for higher limits.

## Quality

- [ ] **More eval cases** (`eval/cases/`): only 2 real cases today. Aim for 10+ varied clips
      (accents, long tangents, multiple quantities, non-English).
- [ ] **Haiku verifier false positive**: on the egg-fried-rice browser run it flagged
      "2 tablespoons cooking oil" as *unused* although step 7 uses it. Add an eval check and
      tune the verifier prompt (or use Sonnet for verify if Haiku stays noisy).
- [ ] **Whisper "four" vs "all"**: large-v3-turbo misheard a quantity on the real clip. Flagged
      items + click-to-hear mitigate it; consider prompting Whisper with cooking vocabulary in
      the browser too (the server already does).

## Product / UX

- [ ] **Paused-for-consent jobs after reload** show "Interrupted — press Retry" instead of
      "waiting for speech model" (no persisted job state for that case). Retry works.
- [ ] **Cross-origin isolation headers** (COOP/COEP via Pages `_headers`) would let the WASM
      fallback use multiple threads on devices without WebGPU — but can break the Turnstile
      iframe. Test before enabling.
- [ ] **Test on phones and Safari**: Safari WebGPU, the WASM fallback, memory limits with the
      762 MB model, and Wake Lock behaviour.
- [ ] **Favicon** (currently 404) and social preview image.
- [ ] Ideas from web/DESIGN-REVIEW.md: import from a video link, shopping list across recipes.

## Maintenance

- [ ] **Dependency hygiene**: npm's optional-dependency bug has twice dropped native binaries
      (esbuild/rollup/lightningcss). If builds fail with "Cannot find module …-darwin-arm64",
      delete `node_modules` + `package-lock.json` and reinstall. CI will catch it once it exists.
- [ ] **wrangler** is pinned at 4.145.0 (4.146.0's tarball 404'd on release day) — update.
- [ ] **Key rotation**: new Console key → `npx wrangler secret put ANTHROPIC_API_KEY` → delete old key.
