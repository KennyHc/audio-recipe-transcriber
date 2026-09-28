import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Never let tests read or write the real data/ library (a running dev server
    // would also "recover" test jobs mid-run).
    env: { RECIPE_DATA_DIR: mkdtempSync(path.join(tmpdir(), "recipe-test-")) },
  },
});
