import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

/**
 * The workbench is loaded by two entries: a browser tab served by the workspace
 * Host, and the Electron window. Both consume the same built assets, so the
 * bundle uses relative asset URLs and keeps no absolute origin.
 */
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version) },
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 4176,
    strictPort: true,
  },
});
