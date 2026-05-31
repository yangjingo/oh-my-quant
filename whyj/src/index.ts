#!/usr/bin/env bun
/**
 * WhyJ Quant — Interactive AI-powered quantitative analysis terminal.
 *
 * Usage:
 *   bun run src/index.ts           # Start interactive REPL
 *   whyj                            # After global install
 */

import { render } from "ink";
import React from "react";
import { App } from "./app.tsx";

// Load environment variables from project root .env
const envPaths = [".env", "../.env"];
for (const p of envPaths) {
  try {
    const content = await Bun.file(p).text();
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const value = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  } catch {
    // File doesn't exist, skip
  }
}

const { unmount } = render(React.createElement(App));

// Handle exit
process.on("SIGINT", () => {
  unmount();
  process.exit(0);
});

process.on("SIGTERM", () => {
  unmount();
  process.exit(0);
});
