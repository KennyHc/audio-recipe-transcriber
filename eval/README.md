# eval/

Fixtures, test cases and a scoring harness for iterating on the
extractor/verifier prompts without going through the full upload -> whisper
-> extract -> verify pipeline (and without touching `data/`, which is real
job storage).

## fixtures/

`fixtures/sample-transcript.json` is a hand-written, intentionally messy
`Transcript` (garlic butter pasta) that exercises the extractor rules in
`server/src/prompts/extractor.ts`: small talk and a sponsor read to ignore, a
tangent, a self-correction ("two tablespoons — actually make it three"), a
vague amount ("a good glug of olive oil"), an ingredient (parmesan) that's
used in a step but never explicitly introduced, and stated times/temperatures.

Run the extractor+verifier against it from the CLI (needs `ANTHROPIC_API_KEY`
set, e.g. in the repo-root `.env`, or `CLAUDE_BACKEND=cli` for the local
Claude CLI):

```sh
npm run extract -w server -- eval/fixtures/sample-transcript.json
```

This prints the resulting `Recipe` JSON to stdout — no job is created, no
audio or whisper involved.

## cases/

Each case is a folder:

```
eval/cases/<name>/audio.<ext>       the source clip (mp3, wav, m4a, ...) — optional
                                     if transcript.json is already present
eval/cases/<name>/transcript.json   normalised Transcript — generated from
                                     audio on first eval run and cached here
eval/cases/<name>/expected.json     a rubric (NOT an exact expected Recipe) —
                                     see server/src/eval/rubric.ts
```

`expected.json` validates against the `Rubric` Zod schema in
`server/src/eval/rubric.ts`. Wording varies run to run (this is an LLM
pipeline), so a rubric checks the things that actually matter: the right
ingredients with the right amounts, nothing invented, steps in a sensible
order, and warnings where the audio was genuinely vague. Read the comment at
the top of `rubric.ts` for the exact matching rules (item/alias matching with
plural tolerance, unit normalisation, greedy most-specific-first ingredient
assignment) — `server/src/eval/score.ts` implements them and
`server/src/eval/score.test.ts` has synthetic examples of each rule plus
regression tests against real recorded outputs in
`server/src/eval/__fixtures__/`.

## Running the harness

```sh
npm run eval                              # every case in eval/cases/, backend from CLAUDE_BACKEND
npm run eval -- --case egg-fried-rice     # just one case
npm run eval -- --runs 3                  # repeat each case 3x to see run-to-run variance
```

Cases run sequentially, never in parallel — with `CLAUDE_BACKEND=cli` (the
default) each run bills your own Claude subscription through the local
`claude` CLI, so the harness doesn't hammer it with concurrent calls.

For each case, the harness:

1. Loads `transcript.json` if present; otherwise transcribes `audio.*` with
   the same ffmpeg+whisper pipeline the app uses, and writes `transcript.json`
   into the case folder so later runs skip whisper.
2. Runs `extractRecipe` + `verifyRecipe` (a verifier failure is downgraded to
   a single `"other"` warning, same as the real pipeline in
   `server/src/pipeline/run.ts` — it does not fail the case).
3. Scores the resulting `Recipe` against `expected.json` with `scoreRecipe`.
4. Saves `{ recipe, score, durationMs, backend, models }` to
   `eval/results/<timestamp>/<case>[.runN].json`, and a `summary.json` for
   the whole run.

It prints a compact table (case, run, score %, passed/total, duration), then
the detail of every failed check, then an overall pass rate. The process
exits with code 1 if any check in any run failed.

## What's gitignored

Real audio clips and the transcripts derived from them are third-party
content and stay local only:

```
eval/cases/*/audio.*
eval/cases/*/transcript.json
eval/results/
```

(`garlic-pasta-messy/transcript.json` is a hand-written synthetic transcript,
not derived from a real recording, so it's committed as an exception — see
the root `.gitignore`.)
