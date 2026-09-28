import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { PORT } from "./config.ts";
import { recoverInterruptedJobs } from "./pipeline/run.ts";

async function main() {
  await recoverInterruptedJobs();
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`server listening on http://localhost:${info.port}`);
  });
}

void main();
