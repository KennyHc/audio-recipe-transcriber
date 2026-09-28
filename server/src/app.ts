import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";
import { nanoid } from "nanoid";
import { createReadStream, existsSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  type ApiError,
  type Job,
  Recipe,
  RollbackRequest,
} from "@recipe/shared";
import { isJobRunning, runPipeline, runReextract } from "./pipeline/run.ts";
import {
  createJob,
  deleteJob,
  findOriginalAudio,
  getJob,
  getLatestVersion,
  getTranscript,
  getVersion,
  listJobs,
  listVersions,
  originalAudioPath,
  saveJob,
  saveVersion,
} from "./storage.ts";

const ALLOWED_EXTENSIONS = new Set(["mp3", "m4a", "wav", "webm", "ogg", "mp4", "aac", "flac"]);
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB

const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
  mp4: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
};

// The Hono app is exported without starting a server so tests can call
// app.request(...) directly; index.ts does the listening.
export const app = new Hono();

app.use("*", logger());

function apiError(message: string): ApiError {
  return { error: message };
}

function extOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

// ---------------------------------------------------------------------------
// POST /api/jobs
// ---------------------------------------------------------------------------

app.post("/api/jobs", bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: (c) => c.json(apiError("File too large (max 200 MB)."), 413) }), async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json(apiError("Could not parse multipart form data."), 400);
  }

  const audio = body["audio"];
  if (!(audio instanceof File)) {
    return c.json(apiError('Missing "audio" field in multipart form data.'), 400);
  }

  const ext = extOf(audio.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return c.json(
      apiError(`Unsupported file extension ".${ext || "?"}". Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}.`),
      400,
    );
  }

  const id = nanoid();
  const now = new Date().toISOString();
  const job: Job = {
    id,
    fileName: audio.name,
    status: "queued",
    error: null,
    title: null,
    createdAt: now,
    updatedAt: now,
  };

  await createJob(job);
  const buffer = Buffer.from(await audio.arrayBuffer());
  await writeFile(originalAudioPath(id, ext), buffer);

  // Marks the job queued and starts the pipeline in the background; the client polls GET /api/jobs/:id.
  await runPipeline(id);

  return c.json(job, 201);
});

// ---------------------------------------------------------------------------
// GET /api/jobs
// ---------------------------------------------------------------------------

app.get("/api/jobs", async (c) => {
  const jobs = await listJobs();
  return c.json(jobs);
});

// ---------------------------------------------------------------------------
// GET /api/jobs/:id
// ---------------------------------------------------------------------------

app.get("/api/jobs/:id", async (c) => {
  const job = await getJob(c.req.param("id"));
  if (!job) return c.json(apiError("Job not found."), 404);
  return c.json(job);
});

// ---------------------------------------------------------------------------
// GET /api/jobs/:id/transcript
// ---------------------------------------------------------------------------

app.get("/api/jobs/:id/transcript", async (c) => {
  const id = c.req.param("id");
  const job = await getJob(id);
  if (!job) return c.json(apiError("Job not found."), 404);

  const transcript = await getTranscript(id);
  if (!transcript) return c.json(apiError("Transcript not available yet."), 404);
  return c.json(transcript);
});

// ---------------------------------------------------------------------------
// GET /api/jobs/:id/recipe
// ---------------------------------------------------------------------------

app.get("/api/jobs/:id/recipe", async (c) => {
  const id = c.req.param("id");
  const job = await getJob(id);
  if (!job) return c.json(apiError("Job not found."), 404);

  const versioned = await getLatestVersion(id);
  if (!versioned) return c.json(apiError("Recipe not available yet."), 404);
  return c.json(versioned);
});

// ---------------------------------------------------------------------------
// PUT /api/jobs/:id/recipe
// ---------------------------------------------------------------------------

app.put("/api/jobs/:id/recipe", async (c) => {
  const id = c.req.param("id");
  const job = await getJob(id);
  if (!job) return c.json(apiError("Job not found."), 404);

  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json(apiError("Request body must be JSON."), 400);
  }

  const parsed = Recipe.safeParse(json);
  if (!parsed.success) {
    return c.json(apiError(`Invalid recipe: ${parsed.error.message}`), 400);
  }

  const versioned = await saveVersion(id, parsed.data, "edited");
  await saveJob({ ...job, title: parsed.data.title, updatedAt: new Date().toISOString() });
  return c.json(versioned);
});

// ---------------------------------------------------------------------------
// GET /api/jobs/:id/recipe/versions
// ---------------------------------------------------------------------------

app.get("/api/jobs/:id/recipe/versions", async (c) => {
  const id = c.req.param("id");
  const job = await getJob(id);
  if (!job) return c.json(apiError("Job not found."), 404);

  const versions = await listVersions(id);
  return c.json(versions);
});

// ---------------------------------------------------------------------------
// GET /api/jobs/:id/recipe/versions/:v
// ---------------------------------------------------------------------------

app.get("/api/jobs/:id/recipe/versions/:v", async (c) => {
  const id = c.req.param("id");
  const job = await getJob(id);
  if (!job) return c.json(apiError("Job not found."), 404);

  const version = Number(c.req.param("v"));
  if (!Number.isInteger(version)) return c.json(apiError("Invalid version number."), 400);

  const versioned = await getVersion(id, version);
  if (!versioned) return c.json(apiError(`Version ${version} not found.`), 404);
  return c.json(versioned);
});

// ---------------------------------------------------------------------------
// POST /api/jobs/:id/recipe/rollback
// ---------------------------------------------------------------------------

app.post("/api/jobs/:id/recipe/rollback", async (c) => {
  const id = c.req.param("id");
  const job = await getJob(id);
  if (!job) return c.json(apiError("Job not found."), 404);

  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json(apiError("Request body must be JSON."), 400);
  }

  const parsed = RollbackRequest.safeParse(json);
  if (!parsed.success) {
    return c.json(apiError(`Invalid rollback request: ${parsed.error.message}`), 400);
  }

  const target = await getVersion(id, parsed.data.version);
  if (!target) return c.json(apiError(`Version ${parsed.data.version} not found.`), 404);

  const versioned = await saveVersion(id, target.recipe, "rollback", `Restored from v${parsed.data.version}`);
  await saveJob({ ...job, title: target.recipe.title, updatedAt: new Date().toISOString() });
  return c.json(versioned);
});

// ---------------------------------------------------------------------------
// POST /api/jobs/:id/reextract
// ---------------------------------------------------------------------------

app.post("/api/jobs/:id/reextract", async (c) => {
  const id = c.req.param("id");
  const job = await getJob(id);
  if (!job) return c.json(apiError("Job not found."), 404);

  if (isJobRunning(id)) {
    return c.json(apiError("Job is already running."), 409);
  }

  const transcript = await getTranscript(id);
  if (!transcript) {
    return c.json(apiError("No transcript available to re-extract from."), 409);
  }

  await runReextract(id);
  const updated = await getJob(id);
  return c.json(updated ?? job);
});

// ---------------------------------------------------------------------------
// POST /api/jobs/:id/retry
// ---------------------------------------------------------------------------

app.post("/api/jobs/:id/retry", async (c) => {
  const id = c.req.param("id");
  const job = await getJob(id);
  if (!job) return c.json(apiError("Job not found."), 404);

  if (isJobRunning(id)) {
    return c.json(apiError("Job is already running."), 409);
  }

  if (job.status !== "error") {
    return c.json(apiError("Job is not in an error state."), 409);
  }

  const audioPath = await findOriginalAudio(id);
  if (!audioPath) {
    return c.json(apiError("Original audio file is missing; cannot retry. Re-upload the audio instead."), 409);
  }

  await runPipeline(id);
  const updated = await getJob(id);
  return c.json(updated ?? job);
});

// ---------------------------------------------------------------------------
// GET /api/jobs/:id/audio  (Range-capable)
// ---------------------------------------------------------------------------

app.get("/api/jobs/:id/audio", async (c) => {
  const id = c.req.param("id");
  const job = await getJob(id);
  if (!job) return c.json(apiError("Job not found."), 404);

  const audioPath = await findOriginalAudio(id);
  if (!audioPath || !existsSync(audioPath)) {
    return c.json(apiError("Audio file not found."), 404);
  }

  const ext = extOf(audioPath);
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const { size } = statSync(audioPath);
  const range = c.req.header("range");

  if (!range) {
    const stream = createReadStream(audioPath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  const startStr = match[1];
  const endStr = match[2];
  let start: number;
  let end: number;
  if (startStr === "") {
    // suffix range: "bytes=-500" -> last 500 bytes
    const suffixLength = Number(endStr);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? size - 1 : Number(endStr);
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  end = Math.min(end, size - 1);

  const stream = createReadStream(audioPath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/jobs/:id
// ---------------------------------------------------------------------------

app.delete("/api/jobs/:id", async (c) => {
  const id = c.req.param("id");
  const job = await getJob(id);
  if (!job) return c.json(apiError("Job not found."), 404);

  await deleteJob(id);
  return new Response(null, { status: 204 });
});

// ---------------------------------------------------------------------------
// 404 fallback
// ---------------------------------------------------------------------------

app.notFound((c) => c.json(apiError("Not found."), 404));

app.onError((err, c) => {
  console.error(err);
  return c.json(apiError(err instanceof Error ? err.message : "Internal server error."), 500);
});
