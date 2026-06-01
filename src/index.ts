#!/usr/bin/env node
/**
 * WhyJ Quant — Interactive AI-powered quantitative analysis terminal.
 *
 *   bun run src/index.ts                Interactive REPL
 *   bun run src/index.ts -- -c "/help"   One-shot command
 */
import { migrateOldConfig, loadSettings } from "./storage/index.ts";
import { parseCommand, executeCommand } from "./commands/registry.ts";

// 1. Migrate old config, then load settings
migrateOldConfig();
const settings = loadSettings();

// 2. Inject API keys from settings into process.env (so MCP client can find them)
for (const [key, value] of Object.entries(settings.apiKeys)) {
  if (value && !process.env[key]) process.env[key] = value;
}

// 3. One-shot or interactive
const args = process.argv.slice(2);
const idxC = args.indexOf("-c");
const idxCmd = args.indexOf("--command");
const cmdArg = idxC >= 0 ? args[idxC + 1] : idxCmd >= 0 ? args[idxCmd + 1] : null;

if (cmdArg) {
  // Fix MSYS2 path mangling: "/config" → "C:/.../git/.../config"
  const fixed = cmdArg.replace(/^[A-Z]:\/[^ ]+\/(\w+)/, "/$1");
  await runOneShot(fixed);
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
