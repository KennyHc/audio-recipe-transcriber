import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // test/emulator/* share one Firestore + Auth emulator and wipe it between tests, so files
    // must not run concurrently. test/unit/* need no emulator: `npx vitest run test/unit`.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
