import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The workbench is loaded by two entries: a browser tab served by the workspace
 * Host, and the Electron window. Both consume the same built assets, so the
 * bundle uses relative asset URLs and keeps no absolute origin.
 */
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 4176,
    strictPort: true,
  },
});
