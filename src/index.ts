#!/usr/bin/env bun
/**
 * WhyJ Quant — Interactive AI-powered quantitative analysis terminal.
 *
 *   bun run src/index.ts                Interactive REPL
 *   bun run src/index.ts -- -c "/help"   One-shot command
 */
import { loadConfig } from "./storage/index.ts";
import { parseCommand, executeCommand } from "./commands/registry.ts";

// 1. Load .env files (backward compat)
for (const p of [".env", "../.env"]) {
  try {
    const content = await Bun.file(p).text();
    for (const line of content.split("\n")) {
      const t = line.trim();
      if (t && !t.startsWith("#")) {
        const i = t.indexOf("=");
        if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
      }
    }
  } catch { /* ok */ }
}

// 2. Merge API keys from .ohquant/config.json into process.env
try {
  const cfg = loadConfig();
  for (const [k, v] of Object.entries(cfg.apiKeys)) {
    if (v) process.env[k] ||= v;
  }
} catch { /* ok */ }

// 3. One-shot or interactive
const args = Bun.argv.slice(2);
const idxC = args.indexOf("-c");
const idxCmd = args.indexOf("--command");
const cmdArg = idxC >= 0 ? args[idxC + 1] : idxCmd >= 0 ? args[idxCmd + 1] : null;

if (cmdArg) {
  await runOneShot(cmdArg);
} else {
  const { render } = await import("ink");
  const React = await import("react");
  const { App } = await import("./app.tsx");
  const { unmount } = render(React.createElement(App));
  process.on("SIGINT", () => { unmount(); process.exit(0); });
  process.on("SIGTERM", () => { unmount(); process.exit(0); });
}

async function runOneShot(input: string) {
  const parsed = parseCommand(input);
  if (!parsed) {
    console.log(`Not a slash command: ${input}`);
    process.exit(1);
  }
  const result = await executeCommand(parsed);
  if (result.success) console.log(result.message);
  else console.error(`✗ ${result.message}`);
  process.exit(result.success ? 0 : 1);
}
