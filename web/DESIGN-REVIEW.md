# Design review

Scope: refinement of the current implementation against `web/DESIGN.md`'s direction (cool
light-blue palette, serif titles, cookbook feel). Evaluated in the browser at ~1280px and
375px, light and dark, on `#/`, `#/jobs/oGJ7cuzG07uDn4uMNn-mM` (Easy Egg Fried Rice, 3
warnings) and `#/jobs/demo-garlic-pasta` (3 warnings + version history). The other agent was
mid-implementation of DESIGN.md while this review was written — judged the direction, not
every in-flight pixel.

## Principles

1. **Ingredients and method are read differently — support scanning, not just reading.**
   Ingredient lists are scanned for a specific item; method is read sequentially. Distinct
   typographic treatment (weight, alignment, density) for each aids the switch.
   [NN/g: Scanning Patterns](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content-discovered/)
2. **Cook mode: keep the screen on, enlarge the active step, and dim the rest.** Table-stakes
   in every well-regarded recipe app (Crouton, Mela, Paprika) because phones lock mid-step
   with wet/floury hands. [Crouton review](https://www.pann-app.com/blog/crouton-app-review),
   [Wake Lock API cook-mode issue](https://github.com/NolanFoster/seasoned-app/issues/510)
3. **Body/instructional text reads best at 45–75 characters per line (~66 optimal).**
   Longer lines cause tracking fatigue at reading distance; too-short lines break rhythm.
   [Baymard: Readability — The Optimal Line Length](https://baymard.com/blog/line-length-readability)
4. **Surface AI uncertainty as inline, low-alarm signals the user can act on, not warnings that
   demand attention.** Confidence labels alone aren't very actionable — pair them with *why*
   (source text) and let users fix it inline (edit) rather than just flagging it.
   [NN/g: AI Hallucinations — What Designers Need to Know](https://www.nngroup.com/articles/ai-hallucinations/),
   [CoCreate: Probabilistic UX Design](https://cocreate.consulting/field-notes/probabilistic-ux-design-patterns)
5. **Progressive disclosure: show what's needed, collapse the rest — and stop at one extra
   level.** More than one or two disclosure levels loses users; use it to keep primary
   content (ingredients/steps) uncluttered by secondary content (warnings, transcript).
   [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
6. **Seek-to-source: transcript and structured content should be mutually navigable.**
   Timestamp affordances on every claim, and highlighting the currently-playing
   segment/step, is the core trust mechanic that lets a user verify what the AI extracted.
   (Established podcast-player / synced-transcript pattern.)
7. **Recipe pages exist to serve the person cooking, not to look impressive on a shelf** —
   thumb-friendly hit targets, generous spacing near action controls, minimal chrome.
   [Serious Eats / recipe layout best practice discussion](https://muffingroup.com/blog/recipe-website-design/)
8. **Repeated/interruptive alerts lose effectiveness fast (alarm fatigue).** A single
   collapsed "N things to double-check" summary is right — the risk is in what happens
   *inside* it and inline, not the summary itself.
   [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)

## Findings

### What already works
- The vague/inferred pill + tooltip with `sourceText` (`ConfidenceBadge.tsx`) is a good
  implementation of Principle 4 — it shows provenance without alarm, and only appears when
  not `"stated"`.
- `WarningsPanel` collapsed-by-default summary + inline row highlighting is a clean
  single-level disclosure (Principle 5/8) — doesn't nest further, doesn't duplicate the
  message everywhere.
- Timestamp chips are present on ingredients, steps, and tips consistently (Principle 6),
  and the active step gets an accent-tinted row + left border while the transcript segment
  syncs too — the mutual-navigation loop actually works end-to-end.
- Serif numerals/title, tabular-nums on quantities and timestamps, sticky ingredient card on
  desktop — all faithful to DESIGN.md and give it real cookbook character.
- Library and job page hold up fine down to 375px; nothing overflows or clips.

### Problems
- **No cook mode at all** (Principle 2). This is the single biggest gap between this app and
  every recipe app used as a comparison point. Right now the phone will lock mid-step, the
  method text is the same size as everything else, and there's no way to advance
  hands-free. For a tool whose whole purpose is "listen along while you cook," this is the
  most consequential missing piece, not just a nice-to-have.
- **Method step line length is uncontrolled** (Principle 3). `StepsList.tsx` step text
  (`text-[15px] sm:text-[17px] leading-[1.6]`) has no `max-width`/`ch` constraint, so on a
  wide desktop window the Method column can run past 90+ characters per line — well outside
  the 45–75 char range, hurting the exact "read while cooking" use case DESIGN.md cares
  about. The header description already does this right (`max-w-[65ch]`); steps don't.
- **Inline warning text competes with the confidence pill for the same real estate**
  (Principle 4/8). In `IngredientList.tsx` and `StepsList.tsx`, the warning message (with a
  small dot) sits directly under the ingredient/step text at the same visual weight as the
  confidence badge and timestamp chip — e.g. "parmesan, grated" shows `inferred` pill +
  timestamp + a full sentence of warning text all in one crowded line-wrap. On the demo
  recipe (3 warnings) this is fine; on a messier real transcript with more warnings per
  item it will get noisy fast.
- **Confidence badge and warning are two separate, redundant signals on the same row.**
  A `vague`/`inferred` pill *and* a caution-dot message can both render for the same
  ingredient, telling the user "this is uncertain" twice in different visual languages.
  Consolidating would reduce alarm fatigue (Principle 8) without losing information.
- **Ingredient/step warning highlight has no way to be dismissed or marked resolved.**
  Once a user reads "Parmesan is used in a step but was never introduced with an amount"
  and either fixes it via Edit or judges it fine, the tinted background and message persist
  forever with no acknowledgment affordance — every future visit re-surfaces the same
  "alarm." Small persistent state (e.g. locally remember dismissed warning ids) would
  respect Principle 8 much better.
- **The `⋯` menu on the job page mixes destructive-ish and read-only actions with no
  grouping** (History, Re-extract, Copy as Markdown, Print) — not wrong, but Re-extract
  (creates a new version, costs an LLM call) sits visually identical to Copy/Print
  (instant, free). A divider or subtler treatment would better signal weight.
- **Library card status row is minimal to the point of being uninformative.** DESIGN.md
  specifies "small colored dot + label; 'Ready' doesn't need a badge" — in practice, for a
  finished recipe, the only differentiator from an in-progress one is the *absence* of a
  dot, which is easy to misread as a loading state rather than confirmation of readiness.

## Proposed refinements

Ranked by impact/effort within each tier.

### Small (CSS/copy/spacing, <30 min each)
1. **Constrain Method step text width.** Add `max-w-[70ch]` (or a fixed `max-w-prose`
   equivalent) to the `<p>` in `StepsList.tsx` (line 48). Why: Principle 3 — this is the
   single highest-impact one-line fix for the app's core reading experience on wide
   screens. Where: `web/src/components/StepsList.tsx`.
2. **De-emphasize the inline warning message relative to the confidence pill.** Give the
   caution message its own line with slightly smaller/lighter type (e.g. `text-[11px]`)
   consistently below the pill row rather than wrapped inline with it, in both
   `IngredientList.tsx` and `StepsList.tsx`. Why: Principle 4/8 — reduces visual noise
   without removing information. Where: `web/src/components/IngredientList.tsx`,
   `web/src/components/StepsList.tsx`.
3. **Tighten Library status affordance copy.** Add an explicit "Ready" text state (not just
   dot-absence) so a finished recipe is unambiguous at a glance, matching what DESIGN.md
   already asks for but isn't fully realized. Where: `web/src/components/StatusBadge.tsx`,
   `web/src/pages/Library.tsx`.
4. **Add a visual separator before "Re-extract" in the job-page dropdown**, since it's the
   only action that mutates state/costs a model call among otherwise inert actions
   (Copy/Print/History). Where: `web/src/pages/JobPage.tsx` (`DropdownMenuContent`, ~line
   389).
5. **Strengthen the ingredient card border on desktop light mode.** Current
   `--border` (91% lightness) against `--background` (98%) is very low-contrast — the
   sticky ingredients card nearly disappears into the page background at 1280px light
   mode, undercutting the "well-set cookbook page" feel DESIGN.md wants. Bump to
   `--border-strong` for that one card, or add the soft shadow already defined for floating
   elements. Where: `web/src/components/RecipeView.tsx` (ingredients `<section>`, line 26),
   `web/src/index.css`.

### Medium (component-level, <½ day each)
1. **Cook mode.** A full-screen/step-focus view: big single step, Wake Lock API to prevent
   screen sleep, swipe/tap or the existing audio sync to advance, ingredients reachable via
   a drawer. Why: Principle 2 — this is the most-cited must-have across every comparable
   app and directly serves this app's stated purpose (following along while cooking).
   Where: new component, entry point from `web/src/components/RecipeView.tsx` or
   `JobPage.tsx` header actions; can reuse `AudioPlayer`'s current-time state and
   `StepsList`'s active-step logic almost as-is.
2. **Consolidate confidence pill + inline warning into one signal per item.** When an
   ingredient/step has both a `confidence` badge and a `RecipeWarning` targeting it, render
   one combined caution treatment instead of two separate visual languages stacked. Why:
   Principle 4/8 — same information, less noise, and it removes an edge case where a vague
   ingredient with a warning currently looks doubly flagged. Where:
   `web/src/components/IngredientList.tsx`, `StepsList.tsx`, possibly a shared
   `WarningInline` component to replace the duplicated warning-rendering block in both
   files (`{targetWarnings.map(...)}` appears near-identically in both).
3. **Locally-dismissible warnings.** Store dismissed warning targets in `localStorage` per
   job/version, and let a user tap the caution dot to mark "seen" / fade it. Why:
   Principle 8 — the current implementation makes warnings permanent even after the user
   has acted on them via Edit, which will erode trust in the "3 things to double-check"
   summary over repeated visits. Where: `web/src/components/WarningsPanel.tsx`,
   `IngredientList.tsx`, `StepsList.tsx`.

## Next steps for the product

Opinionated top 3 marked ★.

1. ★ **Cook mode (screen-awake, step-focus view).** L→M in practice (Wake Lock API is a few
   lines; the focus UI can reuse existing active-step state). Directly serves the app's
   reason to exist — "listen along while cooking" — and it's the single largest gap versus
   every comparable product.
2. ★ **Import from a URL/video link (not just a local file upload).** M–L. Most cooking
   content people actually want to transcribe lives on Instagram/TikTok/YouTube, not as a
   loose audio file already sitting on disk. Removing that friction step (record screen →
   extract audio → upload) plausibly matters more to adoption than any UI polish.
3. ★ **Shopping list / "add ingredients to a list" across recipes.** M. Turns a
   single-recipe tool into something used repeatedly per week; low-hanging given the
   ingredient data is already structured with quantities and units.
4. **Better eval coverage for the extractor/verifier.** M. `CLAUDE.md` states "the extractor
   must never invent quantities" as a hard rule — worth a small golden-transcript regression
   suite (transcript in → expected confidence/warning flags out) so prompt tuning doesn't
   silently regress that guarantee.
5. **Multi-recipe / multi-clip handling.** L. Right now the pipeline assumes "one audio clip
   = one recipe" per CLAUDE.md; a lot of real cooking videos cover a component recipe plus a
   sauce/side in one clip. Detecting and splitting that (or at least warning when it looks
   like two recipes) would reduce silently-wrong extractions.
6. **Print/export polish.** S. `window.print()` and Copy-as-Markdown already exist; a proper
   print stylesheet (single column, no sticky positioning, warnings collapsed) would make
   the existing "Print" action actually usable at the counter instead of ending in a client-
   side layout hack.
7. **Batch/queue uploads.** S–M. Today one job is created per upload one at a time from the
   library; if someone is digitizing a backlog of saved videos, a multi-file drop with a
   simple queue view would remove a lot of repetitive clicking.
8. **Confidence-aware re-extract diffing.** M. When a user hits "Re-extract," show what
   actually changed vs. the prior version (already versioned in History) rather than making
   them compare manually — turns the existing version history from an audit log into a
   useful diff tool.
