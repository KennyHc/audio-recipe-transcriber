/**
 * The HTTP app (routes in shared/cloud.ts). Everything stateful is injected so tests can run
 * it against the Firebase emulators with a fake Claude and a controllable clock; main.ts
 * wires the real dependencies.
 */
import {
  AdminActionRequest,
  APP_CHECK_HEADER,
  CreateRecipeRequest,
  ImportRequest,
  PublishRequest,
  PublishSuggestionsRequest,
  ReportRequest,
} from "@recipe/shared";
import type { Firestore } from "firebase-admin/firestore";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { deleteAccount, getMe } from "./account";
import {
  type AppCheckVerifier,
  type AuthAdmin,
  type AuthVariables,
  optionalUser,
  requireAdmin,
  requireAppCheck,
  requireUser,
} from "./auth";
import type { ClaudeService } from "./claude/types";
import { assertValidConfig, type Config } from "./config";
import { AppError, appError, sanitizedErrorLog, toErrorResponseParts } from "./errors";
import { copyPublicRecipe, type EngagementKind, setEngagement } from "./engagement";
import { importJobs } from "./importer";
import { jsonLogger, type Logger } from "./log";
import type { PipelineDeps } from "./pipeline";
import { adminAction, adminQueue, clientIp, createReport, isAdminToken } from "./moderation";
import { publishRecipe, type PublicDeps, unpublishRecipe } from "./publish";
import { createRecipe, reextractRecipe } from "./recipes";
import { publishSuggestions } from "./suggestions";
import { type FetchLike, MAX_SOURCE_URL_CHARS, previewSource } from "./sources";
import {
  DEFAULT_BODY_LIMIT_BYTES,
  IMPORT_BODY_LIMIT_BYTES,
  parseBodyOrThrow,
  PUBLIC_BODY_LIMIT_BYTES,
  readJsonBody,
} from "./validation";

export interface AppDeps {
  db: Firestore;
  auth: AuthAdmin;
  appCheck: AppCheckVerifier;
  claude: ClaudeService;
  config: Config;
  now?: () => Date;
  logger?: Logger;
  /** Outgoing fetch for oEmbed/TikTok short links only (tests inject a fake). */
  fetch?: FetchLike;
}

/** Account deletion needs a sign-in this recent (seconds). */
export const DELETE_ACCOUNT_MAX_AUTH_AGE_SECONDS = 10 * 60;

export function createApp(deps: AppDeps): Hono<{ Variables: AuthVariables }> {
  // Fail closed: never serve with a config that would disable a limit.
  assertValidConfig(deps.config);

  const { db, auth, config } = deps;
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? jsonLogger;
  const pipeline: PipelineDeps = { db, claude: deps.claude, config, now, logger };
  const publicDeps: PublicDeps = { ...pipeline, fetch: deps.fetch ?? ((input, init) => fetch(input, init)) };

  const app = new Hono<{ Variables: AuthVariables }>();

  // Request log first so it times (and sees the status of) everything below it.
  app.use("*", async (c, next) => {
    const started = Date.now();
    await next();
    logger.log(c.res.status >= 500 ? "ERROR" : c.res.status >= 400 ? "WARNING" : "INFO", "request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      latencyMs: Date.now() - started,
      uid: c.get("user")?.uid,
    });
  });

  app.use(
    "*",
    cors({
      origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", APP_CHECK_HEADER],
      maxAge: 600,
    }),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  const appCheck = requireAppCheck(deps.appCheck, config.requireAppCheck);
  const user = requireUser(auth, { now });
  const recentUser = requireUser(auth, {
    now,
    checkRevoked: true,
    maxAuthAgeSeconds: DELETE_ACCOUNT_MAX_AUTH_AGE_SECONDS,
  });

  app.post("/recipes", appCheck, user, async (c) => {
    const body = parseBodyOrThrow(CreateRecipeRequest, await readJsonBody(c.req.raw, DEFAULT_BODY_LIMIT_BYTES));
    const { status, response } = await createRecipe(pipeline, c.get("user"), body);
    return c.json(response, status);
  });

  app.post("/recipes/:id/reextract", appCheck, user, async (c) => {
    // The body is `{}` by contract; nothing in it is used, so it isn't read.
    return c.json(await reextractRecipe(pipeline, c.get("user"), c.req.param("id")), 200);
  });

  app.post("/import", appCheck, user, async (c) => {
    const body = parseBodyOrThrow(ImportRequest, await readJsonBody(c.req.raw, IMPORT_BODY_LIMIT_BYTES));
    return c.json(await importJobs(db, c.get("user").uid, body), 200);
  });

  app.get("/me", appCheck, user, async (c) => {
    return c.json(await getMe(db, c.get("user"), config.freeMonthlyRecipes, now()), 200);
  });

  app.delete("/me", appCheck, recentUser, async (c) => {
    await deleteAccount(db, auth, c.get("user").uid, logger);
    return c.body(null, 204);
  });

  // ---- Phase 2: publishing + the public recipe bank (shared/public.ts) ----

  app.get("/sources/preview", appCheck, user, async (c) => {
    const url = c.req.query("url");
    if (!url || url.length > MAX_SOURCE_URL_CHARS) throw appError("bad_request");
    return c.json(await previewSource(db, publicDeps.fetch, url), 200);
  });

  app.post("/recipes/:id/publish", appCheck, user, async (c) => {
    const body = parseBodyOrThrow(PublishRequest, await readJsonBody(c.req.raw, PUBLIC_BODY_LIMIT_BYTES));
    return c.json(await publishRecipe(publicDeps, c.get("user"), c.req.param("id"), body), 200);
  });

  app.post("/recipes/:id/publish/suggestions", appCheck, user, async (c) => {
    const body = parseBodyOrThrow(PublishSuggestionsRequest, await readJsonBody(c.req.raw, PUBLIC_BODY_LIMIT_BYTES));
    return c.json(await publishSuggestions(publicDeps, c.get("user"), c.req.param("id"), body), 200);
  });

  app.delete("/recipes/:id/publish", appCheck, user, async (c) => {
    const decoded = c.get("user");
    await unpublishRecipe(db, decoded, c.req.param("id"), isAdminToken(decoded));
    return c.body(null, 204);
  });

  for (const kind of ["like", "save"] as const satisfies readonly EngagementKind[]) {
    app.post(`/public/:id/${kind}`, appCheck, user, async (c) => {
      return c.json(await setEngagement(db, c.get("user"), c.req.param("id"), kind, true, now()), 200);
    });
    app.delete(`/public/:id/${kind}`, appCheck, user, async (c) => {
      return c.json(await setEngagement(db, c.get("user"), c.req.param("id"), kind, false, now()), 200);
    });
  }

  app.post("/public/:id/copy", appCheck, user, async (c) => {
    return c.json(await copyPublicRecipe(db, c.get("user"), c.req.param("id"), now()), 201);
  });

  // Works signed out: App Check required, ID token optional.
  app.post("/public/:id/report", appCheck, optionalUser(auth), async (c) => {
    const body = parseBodyOrThrow(ReportRequest, await readJsonBody(c.req.raw, PUBLIC_BODY_LIMIT_BYTES));
    const ip = clientIp(c.req.header("X-Forwarded-For"));
    await createReport(
      { db, logger, now: now(), reportSalt: config.reportSalt },
      c.get("optionalUser"),
      ip,
      c.req.param("id"),
      body,
    );
    return c.body(null, 202);
  });

  app.get("/admin/queue", appCheck, user, requireAdmin, async (c) => {
    return c.json(await adminQueue(db), 200);
  });

  app.post("/admin/public/:id", appCheck, user, requireAdmin, async (c) => {
    const body = parseBodyOrThrow(AdminActionRequest, await readJsonBody(c.req.raw, PUBLIC_BODY_LIMIT_BYTES));
    await adminAction(db, logger, c.req.param("id"), body, now());
    return c.body(null, 204);
  });

  app.notFound((c) => {
    const { status, body } = toErrorResponseParts(appError("not_found", null, "Not found."));
    return c.json(body, status as ContentfulStatusCode);
  });

  app.onError((err, c) => {
    if (!(err instanceof AppError)) {
      logger.log("ERROR", "unhandled error", {
        method: c.req.method,
        path: c.req.path,
        error: sanitizedErrorLog(err, [config.anthropicApiKey, config.reportSalt]),
      });
    }
    const { status, body } = toErrorResponseParts(err);
    return c.json(body, status as ContentfulStatusCode);
  });

  return app;
}
