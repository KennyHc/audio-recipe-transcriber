# Audio Recipe Transcriber

Local-only tool: upload a short cooking audio clip (one recipe) → get a structured, verifiable recipe.

## Architecture

```
audio ─► ffmpeg (16 kHz mono wav) ─► whisper-cli (local) ─► Transcript
      ─► Extractor agent (Sonnet 5, structured output) ─► ExtractedRecipe
      ─► Verifier agent (Haiku 4.5, structured output)  ─► warnings
      ─► Recipe saved as data/<jobId>/recipes/v1.json ─► React UI
```

- `shared/` — **the contract.** Zod schemas (`recipe.ts`) and the HTTP API (`api.ts`). Both server and web import from `@recipe/shared`. Do not change it without flagging it to the lead; if you believe it must change, stop and report why.
- `server/` — Node + Hono + TypeScript, run with `tsx`. Port 8787.
- `web/` — React + Vite + TypeScript + Tailwind + shadcn/ui. Dev server on http://localhost:5180; Vite proxies `/api` → `http://localhost:8787`.
- `data/<jobId>/` — plain files per job: `job.json`, `audio.<ext>`, `audio.wav`, `transcript.json`, `recipes/v<N>.json` (every edit is a new version; rollback copies forward). No database.

## Conventions

- TypeScript strict everywhere. ESM only.
- Two backends, chosen by `CLAUDE_BACKEND`: `cli` (default — the local `claude -p` CLI on the user's Claude login, see `server/src/llm/claudeCli.ts`; personal local use only) or `api` (official `@anthropic-ai/sdk`, key from `ANTHROPIC_API_KEY`, never exposed to the browser). Prompts and schemas are shared by both.
- Structured outputs: `client.messages.parse({ ..., output_config: { format: zodOutputFormat(Schema) } })` from `@anthropic-ai/sdk/helpers/zod`; guard `parsed_output` being null and check `stop_reason` (`refusal`, `max_tokens`).
- Models come from env (`EXTRACTOR_MODEL`, `VERIFIER_MODEL`); never hardcode elsewhere.
- LLM-facing Zod schemas use `.nullable()`, not `.optional()`.
- Prompts live in `shared/prompts/*.ts` (used by both the server and the in-browser pipeline) so they can be tuned without touching logic.
- The extractor must never invent quantities. Anything not traceable to the transcript is `confidence: "inferred"`.

## Commands

- `npm install` — install all workspaces
- `npm run dev` — server + web together
- `npm run typecheck` — typecheck both
- `npm test` — server + web tests (vitest; server tests use a temp data dir via RECIPE_DATA_DIR)
- `npm run setup:whisper` — download the whisper model into `models/`
- `npm run extract -w server -- <transcript.json>` — run extract+verify on a transcript from the CLI (no audio needed)
