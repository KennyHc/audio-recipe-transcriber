import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A short build id for error reports (lib/errorReporting.ts): the git short sha when this is a git
// checkout, else the UTC build time ("b20261010-1432").
function buildId(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (/^[0-9a-f]{4,40}$/.test(sha)) return sha;
  } catch {
    /* not a git checkout */
  }
  const iso = new Date().toISOString();
  return `b${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 16).replace(":", "")}`;
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(buildId()),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Firestore's Pipelines-only regex engine (~140 KB); unused here — see src/lib/re2jsStub.ts.
      re2js: path.resolve(__dirname, "src/lib/re2jsStub.ts"),
    },
  },
  build: {
    // Spike-only: include whisper-spike.html as a second build entry (see web/src/spike/).
    rollupOptions: { input: { main: path.resolve(__dirname, "index.html"), spike: path.resolve(__dirname, "whisper-spike.html") } },
  },
  server: {
    // 5173 is often taken by other local Vite apps; keep this one predictable.
    port: 5180,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
