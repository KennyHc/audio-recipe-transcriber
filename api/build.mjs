// Bundles src/ + @recipe/shared into dist/server.js for the Cloud Run image.
// Runtime packages stay external: the Dockerfile installs them from package.json, so the
// image never needs the workspace (or @recipe/shared, a devDependency) at runtime.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {});

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  // Subpaths (e.g. @anthropic-ai/sdk/helpers/zod, firebase-admin/auth) are external too.
  external,
  logLevel: "info",
});
