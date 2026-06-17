/**
 * Bash tool — pi NodeExecutionEnv + executeShellWithCapture, codex-style parameters.
 * Reference: pi-agent-core harness/env/nodejs.ts, codex shell tool (command/workdir/timeout_ms).
 */
import { Type } from "typebox";
import type { Static } from "typebox";
import type { AgentTool, AgentToolResult } from "../agent/src/pi/index.ts";
import { executeShellWithCapture } from "../agent/src/pi/index.ts";
import { NodeExecutionEnv } from "../agent/src/pi/node.ts";
import { shellDisplayName } from "./shell.ts";

const DEFAULT_TIMEOUT_MS = 120_000;

const BashParams = Type.Object({
  command: Type.String({
    description:
      "Shell command to execute. Windows uses PowerShell syntax by default: use ';', Get-ChildItem -Force, Get-Content -Tail, foreach ($x in @(...)); do not use Bash idioms such as '&&', 'ls -la', 'tail -n', or 'for x in ...; do'. Unix uses bash/sh syntax. Set WHYJ_SHELL=bash on Windows to force bash.",
  }),
  workdir: Type.Optional(Type.String({ description: "Working directory (defaults to project root)" })),
  timeout_ms: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default 120000)" })),
});

type BashArgs = Static<typeof BashParams>;

let executionEnv: NodeExecutionEnv | undefined;
let shellExecutor = executeShellWithCapture;

export function setBashExecutorForTest(executor?: typeof executeShellWithCapture): void {
  shellExecutor = executor ?? executeShellWithCapture;
}

function getExecutionEnv(): NodeExecutionEnv {
  if (!executionEnv) {
    executionEnv = new NodeExecutionEnv({ cwd: process.cwd() });
  }
  return executionEnv;
}

function normalizeBashArgs(args: unknown): BashArgs {
  const raw = args as Record<string, unknown>;
  const command = Array.isArray(raw.command)
    ? raw.command.map(String).join(" ")
    : String(raw.command ?? "");
  return {
    command,
    workdir: raw.workdir ? String(raw.workdir) : undefined,
    timeout_ms: typeof raw.timeout_ms === "number" ? raw.timeout_ms : undefined,
  };
}

function formatShellResult(result: {
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
}): string {
  const lines: string[] = [];
  if (result.cancelled) {
    lines.push("Command cancelled.");
  } else if (result.exitCode !== undefined) {
    lines.push(`Exit code: ${result.exitCode}`);
  }
  if (result.truncated) {
    lines.push("Output truncated (tail preserved).");
    if (result.fullOutputPath) {
      lines.push(`Full output: ${result.fullOutputPath}`);
    }
  }
  if (result.output.trim()) {
    lines.push(result.output.trimEnd());
  } else if (lines.length === 1 && result.exitCode === 0) {
    lines.push("(no output)");
  }
  return lines.join("\n");
}

export const bashTool: AgentTool<typeof BashParams> = {
  name: "bash",
  label: shellDisplayName(),
  description:
    "Run a shell command and return stdout/stderr. On Windows this is PowerShell: use ';' for sequencing, Get-ChildItem -Force instead of ls -la, Get-Content -Tail instead of tail, and foreach ($x in @(...)) instead of Bash for loops. On Unix use bash syntax. Prefer direct data / quant tools for market data.",
  parameters: BashParams,
  prepareArguments: normalizeBashArgs,
  executionMode: "sequential",
  async execute(_id, args, signal, onUpdate): Promise<AgentToolResult<unknown>> {
    const command = args.command.trim();
    if (!command) throw new Error("bash: command is required");

    const timeoutMs = args.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const env = getExecutionEnv();
    let streamed = "";

    const captured = await shellExecutor(env, command, {
      cwd: args.workdir,
      timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
      abortSignal: signal,
      onChunk: (chunk) => {
        streamed += chunk;
        onUpdate?.({
          content: [{ type: "text", text: streamed.slice(-500) }],
          details: { streaming: true },
        });
      },
    });

    if (!captured.ok) {
      const code = captured.error.code;
      if (code === "timeout") {
        throw new Error(`Command timed out after ${timeoutMs}ms: ${command}`);
      }
      throw new Error(captured.error.message);
    }

    const text = formatShellResult(captured.value);
    if (!captured.value.cancelled && captured.value.exitCode !== 0) {
      throw new Error(text);
    }

    return {
      content: [{ type: "text", text }],
      details: {
        exitCode: captured.value.exitCode,
        cancelled: captured.value.cancelled,
        truncated: captured.value.truncated,
        fullOutputPath: captured.value.fullOutputPath,
        workdir: args.workdir ?? process.cwd(),
        shell: shellDisplayName(),
      },
    };
  },
};

export const SYSTEM_TOOLS: AgentTool[] = [bashTool];
