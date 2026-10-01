import { applyLimiterRequest } from "./limiterLogic";
import type { LimiterRequest } from "./protocol";

/**
 * Single global instance (looked up by id "global") tracking per-visitor and
 * daily-spend counters. Backed by SQLite storage on the free plan via the
 * `new_sqlite_classes` migration in wrangler.toml — this class only uses the
 * key/value storage.get/put API, which is available transparently on top of
 * either storage backend.
 */
export class LimiterDO {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as LimiterRequest;
    const result = await applyLimiterRequest(this.state.storage, body);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
