import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { skillPaths } from "./skills/skill-store.ts";

export const PI_PRESETS = [{ name: "ticker", source: "npm:@narumitw/pi-ticker@0.1.1",
  url: "https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-ticker",
  description: "Yahoo Finance quote widget and /ticker menu; starts empty. Requires Pi TUI and pi-tui-kit." }] as const;

const management = new Set(["install", "remove", "uninstall", "update", "list", "config", "auth", "mcp"]);

/** Only a curated alias and resource paths; argument parsing and all writes belong to Pi. */
export function nativePiArgs(args: string[], extension: string, selectedSkills: readonly string[]): string[] {
  if (management.has(args[0] ?? "")) {
    const forwarded = [...args];
    if (["install", "remove", "uninstall"].includes(args[0]!)) {
      const preset = PI_PRESETS.find(item => item.name === args[1]);
      if (preset) forwarded[1] = preset.source;
    }
    return forwarded;
  }
  // Insert before '--' and prompt arguments; leave every user option untouched.
  const optionArgs = args.slice(0, args.indexOf("--") < 0 ? args.length : args.indexOf("--"));
  return ["--extension", extension,
    ...(optionArgs.some(arg => arg === "--no-skills" || arg === "-ns") ? [] : selectedSkills.flatMap(path => ["--skill", path])), ...args];
}

export async function runNativePi(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === "presets") {
    for (const item of PI_PRESETS) console.log(`${item.name}\t${item.source}\n${item.description}\n${item.url}\n`);
    console.log("whyj pi install ticker   |   whyj pi config   |   whyj pi remove ticker\nOther npm/git/local sources use Pi's normal install/remove arguments.");
    return 0;
  }
  const piRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "..");
  const manifest = JSON.parse(readFileSync(resolve(piRoot, "package.json"), "utf8"));
  const cli = resolve(piRoot, manifest.bin.pi);
  const here = dirname(fileURLToPath(import.meta.url));
  const extension = resolve(here, "pi-extension.ts");
  const passthrough = management.has(args[0] ?? "");
  const forwarded = nativePiArgs(args, extension, passthrough ? [] : skillPaths());
  return new Promise((resolveExit, reject) => {
    // Pi's published Node bundle includes undici APIs unavailable in Bun 1.3.
    const child = spawn(process.versions.bun ? "node" : process.execPath, [cli, ...forwarded], { stdio: "inherit", env: process.env });
    // Both processes share the foreground terminal; Pi handles Ctrl+C itself.
    const onInterrupt = () => {};
    const onTerminate = () => child.kill("SIGTERM");
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);
    const cleanup = () => { process.off("SIGINT", onInterrupt); process.off("SIGTERM", onTerminate); };
    child.once("error", error => { cleanup(); reject(error); });
    child.once("close", (code, signal) => { cleanup(); resolveExit(code ?? (signal === "SIGINT" ? 130 : 1)); });
  });
}
