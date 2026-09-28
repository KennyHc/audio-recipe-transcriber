import path from "node:path";
import { fileURLToPath } from "node:url";

// Single place for env-derived configuration. Nothing here is hardcoded
// elsewhere — see CLAUDE.md: "Models come from env; never hardcode elsewhere."

// API_PORT, not PORT: dev tooling often injects PORT for the web server, and the
// Vite proxy expects the API on 8787.
export const PORT = Number(process.env.API_PORT ?? 8787);

// Relative paths resolve against the repo root (where `npm run setup:whisper` puts
// models/), not the cwd — npm workspaces run the server from server/.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const WHISPER_MODEL_PATH = path.resolve(
  REPO_ROOT,
  process.env.WHISPER_MODEL ?? "./models/ggml-large-v3-turbo.bin",
);

export const WHISPER_CLI_PATH = process.env.WHISPER_CLI ?? "/opt/homebrew/bin/whisper-cli";

export const FFMPEG_PATH = process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg";

export const EXTRACTOR_MODEL = process.env.EXTRACTOR_MODEL ?? "claude-sonnet-5";

export const VERIFIER_MODEL = process.env.VERIFIER_MODEL ?? "claude-haiku-4-5";

// How the extractor/verifier reach Claude:
//   "cli" — the local `claude` CLI (Claude Code), using your Claude login/subscription.
//           Personal, local use only.
//   "api" — the Anthropic API via the SDK, using ANTHROPIC_API_KEY.
export const CLAUDE_BACKEND: "cli" | "api" = process.env.CLAUDE_BACKEND === "api" ? "api" : "cli";

export const CLAUDE_CLI_PATH = process.env.CLAUDE_CLI ?? "claude";
