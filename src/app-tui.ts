/**
 * App entry — agent + frame-buffer TUI.
 * Replaces app.tsx (Ink React) with direct QuantTui rendering.
 */
import { QuantTui } from "./tui/tui.ts";
import { createAgent, injectContext, saveSession, updateSessionCtx } from "./agent/session.ts";
import { ensureDirs, loadSettings } from "./storage/index.ts";
import { connectAll, getServerStatus } from "./data/mcp-client.ts";
import { parseCommand, executeCommand } from "./commands/registry.ts";
import { loadPortfolioSnapshot } from "./tui/local-snapshot.ts";
import type { AppState, UIMessage } from "./tui/types.ts";

function extractText(m: { content: unknown[] }): string {
  return (m.content as Array<{ type?: string; text?: string }>)
    .filter((c) => c.type === "text" && c.text).map((c) => c.text!).join("");
}

function extractThinking(m: { content: unknown[] }): string {
  return (m.content as Array<{ type?: string; thinking?: string }>)
    .filter((c) => c.type === "thinking" && c.thinking).map((c) => c.thinking!).join("\n");
}

function extractTextFromResult(r: unknown): string {
  if (!r || typeof r !== "object") return "";
  const content = (r as { content?: Array<{ text?: string }> }).content;
  if (Array.isArray(content)) return content.filter((c) => c.text).map((c) => c.text!).join("\n");
  return "";
}

export async function startApp(oneShot?: string): Promise<void> {
  ensureDirs();
  loadSettings();

  // ── Build initial state ──
  const pkg = getPkgVersion();
  const initial: AppState = {
    model: "claude-sonnet-4-6",
    version: pkg,
    user: process.env.USER || process.env.USERNAME || "trader",
    activity: "starting",
    cost: 0,
    cacheHit: 100,
    messages: [],
    panel: [],
    input: "",
  };

  const tui = new QuantTui(initial);
  tui.start();

  // ── Connect MCP ──
  try { await connectAll(); getServerStatus(); } catch { /* no servers */ }

  // ── Load portfolio snapshot ──
  try { initial.panel = loadPortfolioSnapshot(); } catch { initial.panel = []; }

  // ── Init agent ──
  const agent = createAgent();
  const uiMessages: UIMessage[] = [];

  agent.subscribe(async (event) => {
    switch (event.type) {
      case "message_start": {
        const m = event.message;
        if (m.role === "assistant") {
          uiMessages.push({ role: "assistant", text: "" });
          tui.update({ messages: [...uiMessages], activity: "thinking" });
        }
        break;
      }
      case "message_update": {
        const m = event.message;
        if (m.role === "assistant") {
          const last = uiMessages[uiMessages.length - 1];
          if (last?.role === "assistant") {
            last.text = extractText(m);
            const thinking = extractThinking(m);
            if (thinking) {
              // Show thinking as a separate message before the assistant text
              const thinkMsg = uiMessages.find((msg) => msg.role === "thinking" && msg.text === thinking.slice(0, 40));
              if (!thinkMsg) {
                uiMessages.push({ role: "thinking", text: thinking });
              } else {
                thinkMsg.text = thinking;
              }
            }
            tui.update({ messages: [...uiMessages], activity: "thinking" });
          }
        }
        break;
      }
      case "message_end": {
        const m = event.message;
        if (m.role === "assistant") {
          const last = uiMessages[uiMessages.length - 1];
          if (last?.role === "assistant") {
            last.text = extractText(m);
          }
          tui.update({ messages: [...uiMessages] });
        }
        break;
      }
      case "tool_execution_start": {
        uiMessages.push({
          role: "tool",
          tool: { name: event.toolName, args: shortArgs(event.args), status: "running", startedAt: Date.now() },
        });
        tui.update({ messages: [...uiMessages], activity: "running tool" });
        break;
      }
      case "tool_execution_update": {
        const last = uiMessages[uiMessages.length - 1];
        if (last?.role === "tool" && last.tool?.name === event.toolName) {
          last.tool.result = extractTextFromResult(event.partialResult);
        }
        tui.update({ messages: [...uiMessages] });
        break;
      }
      case "tool_execution_end": {
        const last = uiMessages[uiMessages.length - 1];
        if (last?.role === "tool" && last.tool?.name === event.toolName) {
          last.tool.status = event.isError ? "error" : "done";
          last.tool.result = extractTextFromResult(event.result);
        }
        tui.update({ messages: [...uiMessages] });
        break;
      }
      case "agent_end": {
        tui.update({ activity: "ready" });
        saveSession(event.messages as any[]);
        try { tui.update({ panel: loadPortfolioSnapshot() }); } catch { /* ok */ }
        break;
      }
    }
  });

  tui.onSubmit(async (input: string) => {
    if (input === "/exit" || input === "/quit") { tui.stop(); process.exit(0); }
    if (input === "/clear") { uiMessages.length = 0; tui.update({ messages: [] }); agent.reset(); return; }

    uiMessages.push({ role: "user", text: input });
    tui.update({ messages: [...uiMessages], activity: "thinking" });

    const parsed = parseCommand(input);
    if (parsed) {
      const result = await executeCommand(parsed);
      uiMessages.push({ role: result.success ? "assistant" : "error", text: result.message });
      tui.update({ messages: [...uiMessages], activity: "ready" });
      if (parsed.flags["symbol"] || parsed.flags["code"])
        updateSessionCtx({ lastSymbol: String(parsed.flags["symbol"] || parsed.flags["code"]) });
    } else {
      try {
        const ctxInput = injectContext(input);
        await agent.prompt(ctxInput);
      } catch (err) {
        uiMessages.push({ role: "error", text: `Agent: ${err instanceof Error ? err.message : String(err)}` });
        tui.update({ messages: [...uiMessages], activity: "ready" });
      }
    }
  });

  if (oneShot) {
    // Execute one-shot and exit
    uiMessages.push({ role: "user", text: oneShot });
    tui.update({ messages: [...uiMessages] });
    const parsed = parseCommand(oneShot);
    if (parsed) {
      const result = await executeCommand(parsed);
      tui.stop();
      console.log(result.message);
      process.exit(result.success ? 0 : 1);
    } else {
      try {
        const ctxInput = injectContext(oneShot);
        await agent.prompt(ctxInput);
      } finally {
        setTimeout(() => { tui.stop(); process.exit(0); }, 5000);
      }
    }
  } else {
    tui.update({ activity: "ready" });
  }
}

function shortArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  if (a.symbol || a.code) return String(a.symbol || a.code);
  if (a.ts_code) return String(a.ts_code);
  if (a.ticker) return String(a.ticker);
  if (a.factor) return String(a.factor);
  return "";
}

function getPkgVersion(): string {
  try {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    return pkg.version || "2.0.5";
  } catch { return "2.0.5"; }
}
