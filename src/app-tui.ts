/**
 * App entry — agent + frame-buffer TUI.
 * Backend logic preserved from app.tsx: agent init, MCP, events, session.
 */
import { QuantTui } from "./tui/tui.ts";
import { createAgent, injectContext, saveSession, updateSessionCtx } from "./agent/session.ts";
import { ensureDirs, loadSettings } from "./storage/index.ts";
import { connectAll } from "./data/mcp-client.ts";
import { parseCommand, executeCommand } from "./commands/registry.ts";
import { loadPortfolioSnapshot } from "./tui/local-snapshot.ts";
import type { AppState, UIMessage } from "./tui/types.ts";

// ── helpers (from app.tsx) ──

function extractText(m: { content: unknown[] }): string {
  return (m.content as Array<{ type?: string; text?: string }>)
    .filter((c) => c.type === "text" && c.text).map((c) => c.text!).join("");
}

function extractThinking(m: { content: unknown[] }): string {
  return (m.content as Array<{ type?: string; thinking?: string }>)
    .filter((c) => c.type === "thinking" && c.thinking).map((c) => c.thinking!).join("\n");
}

function extractTextFromResult(result: unknown): string {
  if (!result) return "";
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content))
    return (r.content as Array<{ text?: string }>).filter((c) => c.text).map((c) => c.text!).join("\n");
  if (typeof r.text === "string") return r.text;
  return typeof result === "string" ? result : "";
}

function extractToolError(result: unknown): string {
  if (!result || typeof result !== "object") return "Tool execution failed";
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content)) {
    const first = (r.content as Array<Record<string, unknown>>)[0];
    return String(first?.text ?? "Tool execution failed");
  }
  return "Tool execution failed";
}

const helpText = [
  "Commands:",
  "",
  "  /data      Download/info      /data download --symbol 000001.SZ",
  "  /factor    Factor analysis    /factor analyze --symbol CODE --factor momentum",
  "  /backtest  SMA backtest       /backtest run --symbol CODE --fast 20 --slow 60",
  "  /risk      Risk metrics       /risk check --symbol CODE",
  "  /benchmark Score/dashboard    /benchmark run --symbol CODE",
  "  /add       Watchlist          /add stock --code CODE --name NAME",
  "  /config    Settings           /config",
  "  /mcp       Data servers       /mcp connect",
  "  /help  /clear  /exit",
  "",
  "Compatibility: /skill  /claw  /watch",
  "",
  "No / prefix -> AI analysis.",
].join("\n");

// ── main ──

export async function startApp(): Promise<void> {
  ensureDirs();
  const settings = loadSettings();

  // Inject API keys for MCP
  for (const [key, value] of Object.entries(settings.env)) {
    if (value && !process.env[key]) process.env[key] = value;
  }

  // Model display name
  const modelLabel = settings.model === "sonnet" ? "claude-sonnet-4-6"
    : settings.model === "opus" ? "claude-opus-4-7"
    : settings.model === "haiku" ? "claude-haiku-4-5"
    : settings.model || "claude-sonnet-4-6";

  const initial: AppState = {
    model: modelLabel,
    version: getPkgVersion(),
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

  // ── Init backend ──
  let busy = false;
  const uiMessages: UIMessage[] = [];

  try {
    await connectAll();
    initial.panel = loadPortfolioSnapshot();
    tui.update({ panel: initial.panel });
  } catch { /* no MCP servers — data tools will fail gracefully */ }

  const agent = createAgent();

  // Agent events -> UI (identical logic to app.tsx)
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
              const key = thinking.slice(0, 60);
              const existing = uiMessages.find((msg) => msg.role === "thinking" && (msg.text ?? "").slice(0, 60) === key);
              if (existing) existing.text = thinking;
              else uiMessages.push({ role: "thinking", text: thinking });
            }
            tui.update({ messages: [...uiMessages] });
          }
        }
        break;
      }
      case "message_end": {
        const m = event.message;
        if (m.role !== "assistant") break;
        const text = extractText(m);
        const stopReason = (m as unknown as Record<string, unknown>).stopReason;
        const isError = stopReason === "error" || stopReason === "aborted";
        const last = uiMessages[uiMessages.length - 1];
        if (last?.role === "assistant") {
          if (isError) {
            last.role = "error";
            last.text = `Agent error: ${text || `API call failed (${stopReason})`}`;
          } else {
            last.text = text;
          }
        } else if (isError) {
          uiMessages.push({ role: "error", text: `Agent error: ${text || `API call failed (${stopReason})`}` });
        }
        tui.update({ messages: [...uiMessages] });
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
        if (last?.role === "tool" && last.tool) {
          last.tool.result = extractTextFromResult(event.partialResult);
        }
        tui.update({ messages: [...uiMessages] });
        break;
      }
      case "tool_execution_end": {
        const last = uiMessages[uiMessages.length - 1];
        if (last?.role === "tool" && last.tool) {
          last.tool.status = event.isError ? "error" : "done";
          last.tool.result = event.isError ? extractToolError(event.result) : extractTextFromResult(event.result);
        }
        tui.update({ messages: [...uiMessages] });
        break;
      }
      case "agent_end": {
        busy = false;
        tui.update({ activity: "ready" });
        saveSession(event.messages as any[]);
        try { tui.update({ panel: loadPortfolioSnapshot() }); } catch { /* ok */ }
        break;
      }
    }
  });

  // Init complete
  tui.update({ activity: "ready" });

  // ── Input handler ──
  tui.onSubmit(async (input: string) => {
    if (busy) return;
    if (input === "/exit" || input === "/quit") { tui.stop(); process.exit(0); }
    if (input === "/clear") { uiMessages.length = 0; tui.update({ messages: [] }); agent.reset(); return; }
    if (input === "/help") { uiMessages.push({ role: "user", text: input }, { role: "assistant", text: helpText }); tui.update({ messages: [...uiMessages] }); return; }
    if (input === "/config" || input === "/portfolio") { uiMessages.push({ role: "assistant", text: "Set API keys via .ohquant/settings.json — restart after editing." }); tui.update({ messages: [...uiMessages] }); return; }

    busy = true;
    uiMessages.push({ role: "user", text: input });
    tui.update({ messages: [...uiMessages], activity: "thinking" });

    const parsed = parseCommand(input);
    if (parsed) {
      try {
        const result = await executeCommand(parsed);
        uiMessages.push({ role: result.success ? "assistant" : "error", text: result.message });
        if (parsed.flags["symbol"] || parsed.flags["code"]) {
          const sym = String(parsed.flags["symbol"] || parsed.flags["code"]);
          updateSessionCtx({ lastSymbol: sym, lastMarket: String(parsed.flags["market"] || parsed.flags["m"] || "A") });
        }
      } catch (err) {
        uiMessages.push({ role: "error", text: err instanceof Error ? err.message : String(err) });
      }
      busy = false;
      tui.update({ messages: [...uiMessages], activity: "ready" });
    } else {
      try {
        await agent.prompt(injectContext(input));
      } catch (err) {
        busy = false;
        uiMessages.push({ role: "error", text: `Agent: ${err instanceof Error ? err.message : String(err)}` });
        tui.update({ messages: [...uiMessages], activity: "ready" });
      }
    }
  });
}

function shortArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  return String(a.symbol || a.code || a.ts_code || a.ticker || a.factor || "");
}

function getPkgVersion(): string {
  try {
    const { readFileSync } = require("node:fs");
    const pkg = JSON.parse(readFileSync(require("node:path").join(process.cwd(), "package.json"), "utf-8"));
    return pkg.version || "2.0.5";
  } catch { return "2.0.5"; }
}
