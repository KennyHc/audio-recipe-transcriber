/**
 * Cloud Run entry point: real Firebase Admin handles + Anthropic client, served on $PORT.
 *
 * Credentials: on Cloud Run, Application Default Credentials of the service's own account
 * (scripts/deploy-api.sh). Locally against the emulators, FIRESTORE_EMULATOR_HOST and
 * FIREBASE_AUTH_EMULATOR_HOST make firebase-admin talk to them instead (no credentials).
 */
import { serve } from "@hono/node-server";
import { initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createApp } from "./app";
import { createAnthropicClaude } from "./claude/anthropic";
import { ConfigError, loadConfig } from "./config";
import { jsonLogger } from "./log";

function start(): void {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    // ConfigError messages name the variable, never its value.
    const message = err instanceof ConfigError ? err.message : "invalid configuration";
    jsonLogger.log("ERROR", `refusing to start: ${message}`);
    process.exit(1);
  }

  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0) {
    jsonLogger.log("ERROR", "refusing to start: PORT is not a valid port");
    process.exit(1);
  }

  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const firebaseApp = initializeApp(
    emulator ? { projectId: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "demo-recipe" } : undefined,
  );

  const app = createApp({
    db: getFirestore(firebaseApp),
    auth: getAuth(firebaseApp),
    appCheck: getAppCheck(firebaseApp),
    claude: createAnthropicClaude({
      apiKey: config.anthropicApiKey,
      extractorModel: config.extractorModel,
      verifierModel: config.verifierModel,
      screeningModel: config.screeningModel,
    }),
    config,
  });

  const server = serve({ fetch: app.fetch, port }, (info) => {
    jsonLogger.log("INFO", "listening", {
      port: info.port,
      emulator,
      requireAppCheck: config.requireAppCheck,
      extractorModel: config.extractorModel,
      verifierModel: config.verifierModel,
      screeningModel: config.screeningModel,
      dailyBudgetUsd: config.dailyBudgetUsd,
      freeMonthlyRecipes: config.freeMonthlyRecipes,
    });
  });

  // Cloud Run sends SIGTERM before stopping an instance; let in-flight requests finish.
  process.on("SIGTERM", () => {
    server.close(() => process.exit(0));
  });
}

start();
