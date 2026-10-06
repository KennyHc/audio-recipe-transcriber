# Launch notes: what to do as real users arrive

A running list of things deliberately deferred while launching. Live today:

- Site: https://recipe-transcriber.pages.dev (Cloudflare Pages, `npm run deploy:site`)
- API: https://recipe-transcriber-api.kennyjiaxi.workers.dev (Worker, `npm run deploy:worker`)
- Limits: 20 recipes/visitor/day, $0.50/day global budget, Claude Haiku 4.5 (see DEPLOY.md)

## Before sharing the link widely

- [ ] ~~Self-host the speech models on Cloudflare R2~~ — **declined for now** (R2 needs a
      payment method on the Cloudflare account). Models keep coming from Hugging Face, which
      works from pages.dev. Known risk: Hugging Face rate limits or new blocks (it already
      rejects any `*.workers.dev` Referer). If downloads start failing for users, revisit
      self-hosting (R2 or another host that supports Range requests and CORS).
- [x] **Anthropic Console spend limit** — confirmed set.
      The Worker's $0.50/day cap is the first line; the Console limit is the hard backstop.
- [ ] **Usage alerts**: Console email alerts at e.g. 50% / 80% of the monthly limit.
- [ ] **Privacy note / terms page**: audio stays on the device; transcripts go to our Worker and
      Anthropic; local data can be deleted in Settings. Needed before strangers use it.
- [x] **Old workers.dev site** now 301-redirects to pages.dev (`redirect/`, deploy with
      `cd redirect && npx wrangler deploy`).
- [x] **Code on GitHub**: https://github.com/KennyHc/audio-recipe-transcriber (`main`).
- [x] **CI**: GitHub Actions (.github/workflows/ci.yml) on every push to main and on PRs — `npm run typecheck`, `npm test`, and
      `npm run build:hosted -w web` (which fails if the bundle contains a key).

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
- [x] **Haiku false alarms / invented amounts**: deterministic rules in shared/warnings.ts now
      run after the models in every runtime — drop "unused" warnings for ingredients a step
      mentions, always flag missing amounts (unless "to taste" etc.), never show a quantity on
      an "inferred" ingredient, merge duplicate warnings. Eval (Haiku/Haiku, 3 runs):
      egg-fried-rice 90% → 98%, garlic pasta 100%. Rubrics can now assert `mustNotWarn`.
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
- [x] **Favicon**: noodle-bowl mark (web/public/favicon.svg).
- [ ] **Social preview image** (Open Graph) for shared links.
- [ ] Ideas from web/DESIGN-REVIEW.md: import from a video link, shopping list across recipes.

## Maintenance

- [ ] **Dependency hygiene**: npm's optional-dependency bug can leave a package's native
      binaries out of package-lock.json (it hid lightningcss's Linux binary until CI failed).
      If a build fails with "Cannot find module …lightningcss…/…rollup…/…esbuild…", regenerate:
      `rm -rf node_modules */node_modules package-lock.json && npm install`, and commit the lockfile.
- [x] **wrangler** updated (now resolves to 4.147.x).
- [ ] **Key rotation**: new Console key → `npx wrangler secret put ANTHROPIC_API_KEY` → delete old key.
