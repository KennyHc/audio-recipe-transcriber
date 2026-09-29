import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
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
