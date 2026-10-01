import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure-Node environment — no workerd/miniflare needed. The worker's
    // logic lives in plain modules (src/*.ts) that only ever receive
    // web-standard globals (fetch/Request/Response/crypto) or injected fakes
    // (storage, fetch) so they're fully testable here. src/index.ts and
    // src/durableObjects/limiter.ts are thin glue over that logic.
    environment: "node",
  },
});
