#!/usr/bin/env node
/**
 * WhyJ Quant — Interactive AI-powered quantitative analysis terminal.
 *
 *   bun run src/index.ts                Interactive REPL
 *   bun run src/index.ts -- -c "/help"   One-shot command
 */
import { migrateOldConfig, loadSettings } from "./storage/index.ts";
import { parseCommand, executeCommand } from "./cli/registry.ts";
import { COMMAND_CATALOG } from "./cli/catalog.ts";
import { formatDoctorText, runDoctor } from "./cli/doctor.ts";
import { printBanner } from "./tui/src/banner.ts";

interface CliEnvelope {
  ok: boolean;
  command: string;
  message?: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

// 1. Migrate old config, then load settings
migrateOldConfig();
const settings = loadSettings();

// 2. Inject API keys from settings into process.env for data adapters and tools.
for (const [key, value] of Object.entries(settings.env)) {
  if (value && !process.env[key]) process.env[key] = value;
}

// 3. One-shot or interactive
const args = process.argv.slice(2);
const idxC = args.indexOf("-c");
const idxCmd = args.indexOf("--command");
const json = args.includes("--json");
const cmdArg = idxC >= 0 ? args[idxC + 1] : idxCmd >= 0 ? args[idxCmd + 1] : null;
const positional = args.filter((arg, index) => {
  if (arg === "--json" || arg === "-c" || arg === "--command") return false;
  if ((args[index - 1] === "-c" || args[index - 1] === "--command")) return false;
  return !arg.startsWith("--");
});

if (args.includes("--help") || args.includes("-h")) {
  writeHelp(json);
  process.exit(0);
} else if (positional[0] === "doctor") {
  const doctor = runDoctor(settings, process.env);
  if (json) writeJson({ ok: true, command: "doctor", data: doctor });
  else console.log(formatDoctorText(doctor));
  process.exit(doctor.ready ? 0 : 1);
} else if (cmdArg) {
  // Fix MSYS2 path mangling: "/config" → "C:/.../git/.../config"
  const fixed = cmdArg.replace(/^[A-Z]:\/[^ ]+\/(\w+)/, "/$1");
  await runOneShot(fixed, json);
} else {
  // Frame-buffer TUI
  const { startApp } = await import("./app.ts");
  await startApp();
}

async function runOneShot(input: string, json: boolean) {
  const parsed = parseCommand(input);
  if (!parsed) {
    writeFailure("not_slash_command", `Not a slash command: ${input}`, json, "command");
    process.exit(1);
  }
  const result = await executeCommand(parsed);
  if (json) {
    const envelope: CliEnvelope = result.success
      ? { ok: true, command: parsed.command, message: result.message, data: result.data }
      : { ok: false, command: parsed.command, error: { code: "command_failed", message: result.message } };
    writeJson(envelope);
  } else if (result.success) {
    console.log(result.message);
  } else {
    console.error(`✗ ${result.message}`);
  }
  process.exit(result.success ? 0 : 1);
}

function writeHelp(json: boolean) {
  const slashCommands = COMMAND_CATALOG.filter((command) => !command.compatibility).map((command) => command.name);
  const compatibility = COMMAND_CATALOG.filter((command) => command.compatibility).map((command) => command.name);
  const help = {
    name: "whyj",
    description: "WhyJ Quant interactive AI-powered quantitative analysis terminal",
    commands: [
      { command: "whyj", description: "Start the interactive frame-buffer TUI" },
      { command: "whyj --json doctor", description: "Check config, auth sources, and runtime readiness" },
      { command: "whyj -c \"/help\"", description: "Run one slash command and exit" },
      { command: "whyj --json -c \"/portfolio\"", description: "Run one slash command and emit a stable JSON envelope" },
    ],
    slashCommands,
    compatibility,
  };
  if (json) writeJson({ ok: true, command: "help", data: help });
  else console.log([
    "WhyJ Quant CLI",
    "",
    "Usage:",
    "  whyj",
    "  whyj --json doctor",
    "  whyj -c \"/help\"",
    "  whyj --json -c \"/portfolio\"",
    "",
    "Slash commands:",
    `  ${help.slashCommands.join("  ")}`,
    "",
    "Compatibility aliases:",
    `  ${help.compatibility.join("  ")}`,
  ].join("\n"));
}

function writeFailure(code: string, message: string, json: boolean, command: string) {
  if (json) writeJson({ ok: false, command, error: { code, message } });
  else console.error(`✗ ${message}`);
}

function writeJson(value: CliEnvelope) {
  console.log(JSON.stringify(value, null, 2));
}
