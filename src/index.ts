#!/usr/bin/env node
/**
 * WhyJ Quant — Interactive AI-powered quantitative analysis terminal.
 *
 *   bun run src/index.ts                Interactive REPL
 *   bun run src/index.ts -- -c "/help"   One-shot command
 */
import { migrateOldConfig, loadSettings } from "./storage/index.ts";
import { parseCommand, executeCommand } from "./commands/registry.ts";
import { printBanner } from "./tui/banner.ts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// 2. Inject API keys from settings into process.env (so MCP client can find them)
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
  const doctor = runDoctor();
  if (json) writeJson({ ok: true, command: "doctor", data: doctor });
  else writeDoctorText(doctor);
  process.exit(doctor.ready ? 0 : 1);
} else if (cmdArg) {
  // Fix MSYS2 path mangling: "/config" → "C:/.../git/.../config"
  const fixed = cmdArg.replace(/^[A-Z]:\/[^ ]+\/(\w+)/, "/$1");
  await runOneShot(fixed, json);
} else {
  // Frame-buffer TUI
  const { startApp } = await import("./app-tui.ts");
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

function getPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "package.json"),
    join(process.cwd(), "package.json"),
  ];
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const pkg = JSON.parse(readFileSync(path, "utf-8")) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // Try the next location.
    }
  }
  return "2.0.5";
}

function runDoctor() {
  const requiredKeys = ["ANTHROPIC_API_KEY", "TUSHARE_TOKEN", "FINANCIAL_DATASETS_KEY", "LLMQUANT_API_KEY"];
  const configKeys = new Set(Object.entries(settings.env).filter(([, value]) => Boolean(value)).map(([key]) => key));
  const envKeys = new Set(requiredKeys.filter((key) => Boolean(process.env[key])));
  const auth = Object.fromEntries(requiredKeys.map((key) => [
    key,
    {
      available: envKeys.has(key) || configKeys.has(key),
      source: envKeys.has(key) ? "env" : configKeys.has(key) ? "config" : "missing",
    },
  ]));
  const cwdOhquant = join(process.cwd(), ".ohquant");
  const ready = true;
  return {
    name: "whyj",
    package: "whyj-quant",
    version: getPackageVersion(),
    runtime: {
      node: process.version,
      platform: process.platform,
    },
    config: {
      path: cwdOhquant,
      exists: existsSync(cwdOhquant),
      model: settings.model,
      thinkingLevel: settings.thinkingLevel,
    },
    auth,
    mcp: {
      configFiles: [join(process.cwd(), ".claude", "mcp.json"), join(process.cwd(), ".mcp.json")]
        .filter((path) => existsSync(path)),
      note: "Run /mcp connect from the TUI or one-shot command to verify endpoint reachability.",
    },
    ready,
  };
}

function writeDoctorText(doctor: ReturnType<typeof runDoctor>) {
  const authLines = Object.entries(doctor.auth)
    .map(([key, value]) => `  ${key.padEnd(24)} ${value.available ? "available" : "missing"} (${value.source})`);
  console.log([
    `whyj doctor`,
    `version: ${doctor.version}`,
    `config: ${doctor.config.path}`,
    `model: ${doctor.config.model}`,
    `auth:`,
    ...authLines,
    `mcp config files: ${doctor.mcp.configFiles.length ? doctor.mcp.configFiles.join(", ") : "none"}`,
  ].join("\n"));
}

function writeHelp(json: boolean) {
  const help = {
    name: "whyj",
    description: "WhyJ Quant interactive AI-powered quantitative analysis terminal",
    commands: [
      { command: "whyj", description: "Start the interactive Ink REPL" },
      { command: "whyj --json doctor", description: "Check config, auth sources, runtime, and MCP config discovery" },
      { command: "whyj -c \"/help\"", description: "Run one slash command and exit" },
      { command: "whyj --json -c \"/factor list\"", description: "Run one slash command and emit a stable JSON envelope" },
    ],
    slashCommands: ["/data", "/factor", "/backtest", "/risk", "/benchmark", "/add", "/config", "/mcp", "/portfolio", "/help", "/clear", "/exit"],
    compatibility: ["/skill", "/claw", "/watch"],
  };
  if (json) writeJson({ ok: true, command: "help", data: help });
  else console.log([
    "WhyJ Quant CLI",
    "",
    "Usage:",
    "  whyj",
    "  whyj --json doctor",
    "  whyj -c \"/help\"",
    "  whyj --json -c \"/factor list\"",
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
