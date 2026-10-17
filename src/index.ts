#!/usr/bin/env node
/**
 * WhyJ Quant — Interactive AI-powered quantitative analysis terminal.
 *
 *   bun run src/index.ts                Interactive REPL
 *   bun run src/index.ts -- -c "/help"   One-shot command
 */
import { COMMAND_CATALOG } from "./cli/catalog.ts";
import { parseDoctorPhases } from "./runtime/workspace/doctor-phases.ts";
import manifest from "../package.json";
import { existsSync } from "node:fs";
import type { OhQuantSettings } from "./types/config.ts";

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

// Parse output mode before loading files so startup errors retain the CLI envelope.
const args = process.argv.slice(2);
const idxC = args.indexOf("-c");
const idxCmd = args.indexOf("--command");
const json = args.includes("--json");
const cmdArg = idxC >= 0 ? args[idxC + 1] : idxCmd >= 0 ? args[idxCmd + 1] : null;
const doctorPhase = args.includes("--phase") ? stringFlag(args, "--phase") ?? true : undefined;
const positional = args.filter((arg, index) => {
  if (arg === "--json" || arg === "-c" || arg === "--command" || arg === "--phase") return false;
  if ((args[index - 1] === "-c" || args[index - 1] === "--command")) return false;
  if (args[index - 1] === "--phase") return false;
  return !arg.startsWith("--");
});

if (args.includes("--version") || args.includes("-V")) {
  if (args.some(arg => !["--version", "-V", "--json"].includes(arg))
    || args.filter(arg => arg === "--version" || arg === "-V").length !== 1
    || args.filter(arg => arg === "--json").length > 1) {
    writeFailure("invalid_arguments", "Use whyj [--json] --version. Version cannot be combined with a command or repeated option.", json, "version");
    process.exit(1);
  }
  writeVersion(json);
  process.exit(0);
}
if (args.includes("--help") || args.includes("-h")) {
  if (args.some(arg => !["--help", "-h", "--json"].includes(arg))
    || args.filter(arg => arg === "--help" || arg === "-h").length !== 1
    || args.filter(arg => arg === "--json").length > 1) {
    writeFailure("invalid_arguments", "Use whyj [--json] --help. Help cannot be combined with a command or repeated option.", json, "help");
    process.exit(1);
  }
  writeHelp(json);
  process.exit(0);
}

// An explicit account-history file must not trigger saved model/data settings or the default Agent path.
const privateAnnualArgs = args.filter(arg => arg !== "--json");
if (privateAnnualArgs[0] === "private-annual") {
  try {
    if (args.filter(arg => arg === "--json").length > 1) throw new Error("Use --json at most once.");
    const { runPrivateAnnualFileCommand } = await import("./cli/private-annual-file.ts");
    const result = await runPrivateAnnualFileCommand(privateAnnualArgs.slice(1), AbortSignal.timeout(60_000));
    if (json) writeJson({ ok: true, command: "private-annual", data: result });
    else console.log(`Private annual HTML written to ${result.output}`);
    process.exit(0);
  } catch (error) {
    writeFailure("private_annual_failed", (error as Error).message, json, "private-annual");
    process.exit(1);
  }
}

// Local paper orders require an explicit private account and intent file. No saved settings or Agent path.
if (privateAnnualArgs[0] === "paper" && privateAnnualArgs[1] === "agent") {
  if (json) { writeFailure("invalid_arguments", "whyj paper agent is an interactive private terminal; omit --json.", true, "paper-agent"); process.exit(1); }
  try { const { runPaperAgentCommand } = await import("./runtime/paper-agent-command.ts"); await runPaperAgentCommand(privateAnnualArgs.slice(1)); process.exit(0); }
  catch (error) { writeFailure("paper_agent_failed", error instanceof Error ? error.message : "Private paper Agent failed.", false, "paper-agent"); process.exit(1); }
}

// File-based local paper actions do not load model settings or an Agent session.
if (privateAnnualArgs[0] === "paper") {
  try {
    if (args.filter(arg => arg === "--json").length > 1) throw new Error("Use --json at most once.");
    const { paperCommandOk, runPaperCommand } = await import("./runtime/paper-command.ts");
    const result = await runPaperCommand(privateAnnualArgs.slice(1), AbortSignal.timeout(60_000));
    const ok = paperCommandOk(result);
    if (json) writeJson(ok ? { ok: true, command: "paper", data: result }
      : { ok: false, command: "paper", data: result, error: { code: "paper_not_completed", message: "Paper operation did not complete; inspect its outcome." } });
    else console.log(JSON.stringify(result, null, 2));
    process.exit(ok ? 0 : 1);
  } catch (error) {
    writeFailure("paper_failed", (error as Error).message, json, "paper");
    process.exit(1);
  }
}

// Alpaca credentials and the broker API are reachable only through this explicit paper command.
if (privateAnnualArgs[0] === "alpaca-paper") {
  try {
    if (args.filter(arg => arg === "--json").length > 1) throw new Error("Use --json at most once.");
    const { alpacaPaperCommandOk, runAlpacaPaperCommand } = await import("./runtime/alpaca-paper-command.ts");
    const result = await runAlpacaPaperCommand(privateAnnualArgs.slice(1), AbortSignal.timeout(60_000));
    const ok = alpacaPaperCommandOk(result);
    if (json) writeJson(ok ? { ok: true, command: "alpaca-paper", data: result }
      : { ok: false, command: "alpaca-paper", data: result,
        error: { code: "alpaca_paper_not_completed", message: "External paper operation needs review or reconciliation." } });
    else console.log(JSON.stringify(result, null, 2));
    process.exit(ok ? 0 : 1);
  } catch (error) {
    writeFailure("alpaca_paper_failed", error instanceof Error ? error.message : "Alpaca paper operation failed.", json, "alpaca-paper");
    process.exit(1);
  }
}

// Root arguments must name an action. A missing one-shot value or unknown flag
// must never silently turn into interactive startup.
if (positional[0] !== "doctor") {
  const actions = args.flatMap((arg, index) => arg === "-c" || arg === "--command" ? [index] : []);
  const invalid = actions.length > 1 || args.filter(arg => arg === "--json").length > 1
    || actions.length === 1 && (!cmdArg?.trim() || cmdArg.startsWith("-"))
    || actions.length === 1 && args.some((arg, index) => index !== actions[0] && index !== actions[0]! + 1
      && arg !== "--json" && arg !== "--")
    || actions.length === 0 && args.some(arg => arg !== "--");
  if (invalid) {
    writeFailure("invalid_arguments", "Use whyj, whyj [--json] -c \"/help\", or whyj [--json] doctor. Unknown, repeated or missing root arguments are not accepted.",
      json, actions.length ? "command" : "startup");
    process.exit(1);
  }
}

// Usage and argument errors are readable even when saved configuration cannot be loaded.
if (cmdArg) {
  const { parseCommand } = await import("./cli/registry.ts");
  const { commandPreflight } = await import("./runtime/workspace/command-preflight.ts");
  const { isInstalledToolProbeSchemaQuery } = await import("./runtime/data/tool-probe-schema.ts");
  const parsed = parseCommand(cmdArg);
  if (parsed && (parsed.command === "help" || commandPreflight(parsed) || isInstalledToolProbeSchemaQuery(parsed)))
    await runOneShot(cmdArg, json);
}

let doctorPhases: ReturnType<typeof parseDoctorPhases>;
if (positional[0] === "doctor") {
  try {
    if (positional.length !== 1 || cmdArg || args.filter(arg => arg === "--phase").length > 1
      || args.filter(arg => arg === "--json").length > 1 || doctorPhase === true
      || args.some((arg, index) => arg.startsWith("-") && args[index - 1] !== "--phase" && !["--json", "--phase", "--"].includes(arg))) {
      throw new Error("Use whyj [--json] doctor [--phase model,tools,data]. Unknown or repeated options are not accepted.");
    }
    doctorPhases = parseDoctorPhases(doctorPhase);
  }
  catch (error) { writeFailure("invalid_arguments", (error as Error).message, json, "doctor"); process.exit(1); }
}

let settings: OhQuantSettings;
try {
  const { migrateOldConfig, loadSettings, saveSettings, resolveSettingsPath } = await import("./storage/index.ts");
  migrateOldConfig();
  const initializeDesktop = process.env.WHYJ_DESKTOP === "1" && !existsSync(resolveSettingsPath());
  settings = loadSettings();
  if (initializeDesktop) {
    settings.preferences.source = "akshare";
    saveSettings(settings);
  }
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  const message = code === "ESTORAGEFORMAT" || code === "ELOCKED"
    ? (error as Error).message : "Could not read settings.json. Check file permissions and retry.";
  writeFailure("settings_unavailable", message, json, positional[0] === "doctor" ? "doctor" : "startup");
  process.exit(1);
}

if (positional[0] === "doctor") {
  const { buildDoctorErrorResult, collectDoctor, formatDoctorFirstSetupText, formatDoctorProgressLine, formatDoctorText } = await import("./cli/doctor.ts");
  try {
    const doctor = await collectDoctor(settings, process.env, json
      ? { phases: doctorPhases }
      : { phases: doctorPhases, onState: (state) => console.log(formatDoctorProgressLine(state)) });
    if (json) writeJson({ ok: true, command: "doctor", data: doctor });
    else console.log(`\n${doctor.mode === "first_setup" && doctor.overall === "unconfigured" ? formatDoctorFirstSetupText(doctor) : formatDoctorText(doctor)}`);
    process.exit(doctor.ready ? 0 : 1);
  } catch (error) {
    const doctor = buildDoctorErrorResult(settings, process.env, error, doctorPhases);
    if (json) writeJson({ ok: false, command: "doctor", data: doctor, error: { code: "doctor_failed", message: doctor.phases.find((phase) => phase.status === "fail")?.error || "Doctor failed" } });
    else console.log(`\n${formatDoctorText(doctor)}`);
    process.exit(1);
  }
} else if (cmdArg) {
  // Fix MSYS2 path mangling: "/config" → "C:/.../git/.../config"
  const fixed = cmdArg.replace(/^[A-Z]:\/[^ ]+\/(\w+)/, "/$1");
  await runOneShot(fixed, json);
} else {
  const { startApp } = await import("./app.ts");
  await startApp();
}

function stringFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function runOneShot(input: string, json: boolean) {
  const { parseCommand, executeCommand } = await import("./cli/registry.ts");
  const parsed = parseCommand(input);
  if (!parsed) {
    writeFailure("not_slash_command", `Not a slash command: ${input}`, json, "command");
    process.exit(1);
  }
  const result = await executeCommand(parsed);
  if (json) {
    const envelope: CliEnvelope = result.success
      ? { ok: true, command: parsed.command, message: result.message, data: result.data }
      : { ok: false, command: parsed.command, error: { code: "command_failed", message: result.message },
        ...(parsed.command === "doctor" && parsed.flags.tool !== undefined && result.data !== undefined ? { data: result.data } : {}) };
    writeJson(envelope);
  } else if (result.success) {
    console.log(result.message);
  } else {
    console.error(`✗ ${result.message}`);
  }
  process.exit(result.success ? 0 : 1);
}

function writeHelp(json: boolean) {
  const slashCommands = COMMAND_CATALOG.map((command) => command.name);
  const help = {
    name: "whyj",
    description: "WhyJ Quant interactive AI-powered quantitative analysis terminal",
    commands: [
      { command: "whyj", description: "Start the interactive frame-buffer TUI" },
      { command: "whyj --version", description: "Show the installed WhyJ and bundled Pi package versions" },
      { command: "whyj --json doctor", description: "Check config, auth sources, and runtime readiness" },
      { command: "whyj -c \"/help\"", description: "Run one slash command and exit" },
      { command: "whyj --json -c \"/portfolio\"", description: "Run one slash command and emit a stable JSON envelope" },
      { command: "whyj private-annual ...", description: "Explicitly export a verified private annual report from a selected history file" },
      { command: "whyj paper ...", description: "Operate an explicitly selected local paper account outside app state" },
      { command: "whyj paper agent --root ABS --account ID", description: "Start a private paper-only Agent with reviewed submit/cancel actions" },
      { command: "whyj alpaca-paper ...", description: "Operate a selected Alpaca paper account with separate paper credentials" },
    ],
    slashCommands,
    slashCommandDetails: COMMAND_CATALOG,
  };
  if (json) writeJson({ ok: true, command: "help", data: help });
  else console.log([
    "WhyJ Quant CLI",
    "",
    "Usage:",
    "  whyj",
    "  whyj --version",
    "  whyj --json doctor",
    "  whyj -c \"/help\"",
    "  whyj --json -c \"/portfolio\"",
    "  whyj private-annual --comparison ID --year YYYY --cutoff YYYY-MM-DD --history-file PATH --output NEW.html",
    "  whyj paper init --root ABS --account ID --currency USD --cash 1000",
    "  whyj paper account --root ABS --account ID",
    "  whyj paper submit|lookup|cancel --root ABS --account ID --intent-file ABS.json",
    "  whyj paper agent --root ABS --account ID",
    "  whyj alpaca-paper account --root ABS --account ID",
    "  whyj alpaca-paper submit|lookup|cancel --root ABS --account ID --intent-file ABS.json",
    "",
    "Slash commands:",
    ...help.slashCommandDetails.map((command) => `  ${command.name.padEnd(12)} ${command.desc}`),
  ].join("\n"));
}

function writeVersion(json: boolean) {
  const data = { version: manifest.version,
    piAgentCore: manifest.dependencies["@earendil-works/pi-agent-core"],
    piAi: manifest.dependencies["@earendil-works/pi-ai"] };
  if (json) writeJson({ ok: true, command: "version", data });
  else console.log(`WhyJ Quant v${data.version} · bundled Pi agent core v${data.piAgentCore} · Pi AI v${data.piAi}`);
}

function writeFailure(code: string, message: string, json: boolean, command: string) {
  if (json) writeJson({ ok: false, command, error: { code, message } });
  else console.error(`✗ ${message}`);
}

function writeJson(value: CliEnvelope) {
  console.log(JSON.stringify(value, null, 2));
}
