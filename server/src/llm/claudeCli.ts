import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { z } from "zod";
import { CLAUDE_CLI_PATH } from "../config.ts";

const TIMEOUT_MS = 5 * 60 * 1000;

interface CliResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  api_error_status?: number | null;
  structured_output?: unknown;
}

function jsonSchemaFor(schema: z.ZodType): object {
  // The CLI's validator rejects the draft-2020-12 "$schema" URI that zod emits.
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: "output" });
  return rest;
}

/**
 * One structured-output call through the local Claude Code CLI (`claude -p`), billed to
 * the user's Claude login rather than an API key. Returns the output validated
 * against `schema`.
 */
export async function callClaudeCli<T extends z.ZodType>(opts: {
  model: string;
  system: string;
  user: string;
  schema: T;
}): Promise<z.infer<T>> {
  const args = [
    "-p",
    "--model", opts.model,
    "--output-format", "json",
    "--no-session-persistence",
    "--tools", "", // pure text-in/JSON-out; no file or shell access
    "--system-prompt", opts.system,
    "--json-schema", JSON.stringify(jsonSchemaFor(opts.schema)),
  ];

  // Without these removed, an API key in .env would make the CLI bill the API
  // instead of the subscription.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const stdout = await new Promise<string>((resolve, reject) => {
    // A neutral cwd so the CLI doesn't pull this repo's CLAUDE.md into the prompt.
    const child = spawn(CLAUDE_CLI_PATH, args, { cwd: tmpdir(), env });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude CLI timed out after ${TIMEOUT_MS / 1000}s.`));
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        e.code === "ENOENT"
          ? new Error(`Claude CLI not found ("${CLAUDE_CLI_PATH}"). Install Claude Code or set CLAUDE_CLI to its path.`)
          : e,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) reject(new Error(`Claude CLI exited with code ${code}: ${err.trim() || "no output"}`));
      else resolve(out);
    });

    child.stdin.end(opts.user);
  });

  let parsed: CliResult;
  try {
    parsed = JSON.parse(stdout) as CliResult;
  } catch {
    throw new Error(`Claude CLI returned non-JSON output: ${stdout.slice(0, 200)}`);
  }
  if (parsed.is_error || parsed.subtype !== "success") {
    const detail = parsed.result || parsed.subtype || "unknown error";
    throw new Error(`Claude CLI call failed: ${detail}`);
  }

  const result = opts.schema.safeParse(parsed.structured_output);
  if (!result.success) {
    throw new Error(`Claude CLI output did not match the schema: ${result.error.message}`);
  }
  return result.data;
}
