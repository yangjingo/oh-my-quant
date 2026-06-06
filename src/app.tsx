import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, useApp, useStdout } from "ink";
import { Sidebar } from "./components/Sidebar.tsx";
import { ConfigPanel } from "./components/ConfigPanel.tsx";
import { Conversation } from "./components/Conversation.tsx";
import { Input } from "./components/Input.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { SIDEBAR_WIDTH } from "./tui/tokens.ts";
import type { MessageProps } from "./components/Message.tsx";
import { parseCommand, executeCommand } from "./commands/registry.ts";
import { ensureDirs, loadSettings } from "./storage/index.ts";
import { connectAll, getServerStatus, type McpServerStatus } from "./data/mcp-client.ts";
import { createAgent, injectContext, saveSession, updateSessionCtx } from "./agent/session.ts";
import type { Agent } from "@earendil-works/pi-agent-core";

function extractText(m: { content: unknown[] }): string {
  return m.content
    .filter((c: unknown) => (c as { type: string }).type === "text")
    .map((c: unknown) => (c as { text: string }).text)
    .join("");
}

function extractThinking(m: { content: unknown[] }): string {
  return m.content
    .filter((c: unknown) => (c as { type: string }).type === "thinking")
    .map((c: unknown) => (c as { thinking: string }).thinking)
    .join("\n");
}

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [messages, setMessages] = useState<MessageProps[]>([]);
  const [mode, setMode] = useState<string>("loading");
  const [lastSymbol, setLastSymbol] = useState<string | null>(null);
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [configOpen, setConfigOpen] = useState(false);
  const agentRef = useRef<Agent>(null!);
  const streamingIdRef = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        ensureDirs();
        loadSettings();
        await connectAll();
        setMcpStatuses(getServerStatus());
      } catch {
        setMcpStatuses([]);
      }

      const agent = createAgent();
      agentRef.current = agent;

      agent.subscribe(async (event) => {
          switch (event.type) {
            case "message_start": {
              const m = event.message;
              if (m.role === "assistant") {
                const id = `agent-${Date.now()}`;
                streamingIdRef.current = id;
                setMessages((prev) => [...prev, { id, role: "system", content: "" }]);
              }
              break;
            }

            case "message_update": {
              const m = event.message;
              if (m.role === "assistant" && streamingIdRef.current) {
                const text = extractText(m);
                const thinking = extractThinking(m);
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === streamingIdRef.current
                      ? { ...msg, content: text, thinking: thinking || (msg.thinking ?? "") }
                      : msg,
                  ),
                );
              }
              break;
            }

            case "message_end": {
              const m = event.message;
              if (m.role !== "assistant") break;
              const text = extractText(m);
              const thinking = extractThinking(m);
              const stopReason = (m as unknown as Record<string, unknown>).stopReason;
              const isError = stopReason === "error" || stopReason === "aborted";

              if (streamingIdRef.current) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === streamingIdRef.current
                      ? {
                          ...msg,
                          role: isError ? "error" : "system",
                          content: isError
                            ? `Agent error: ${text || `API call failed (${stopReason})`}`
                            : text,
                          thinking: thinking || msg.thinking,
                          thinkingDone: true,
                        }
                      : msg,
                  ),
                );
                streamingIdRef.current = null;
              } else if (isError) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `agent-err-${Date.now()}`,
                    role: "error",
                    content: `Agent error: ${text || `API call failed (${stopReason})`}`,
                  },
                ]);
              }
              break;
            }

            case "tool_execution_start":
              setMode("running");
              setMessages((prev) => [
                ...prev,
                {
                  id: `tool-${event.toolCallId}`,
                  role: "tool",
                  content: event.toolName,
                  toolStatus: "running" as const,
                  toolArgs: event.args as Record<string, unknown> | undefined,
                },
              ]);
              break;

            case "tool_execution_update":
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === `tool-${event.toolCallId}`
                    ? { ...msg, content: event.toolName, toolPartial: extractTextFromResult(event.partialResult) }
                    : msg,
                ),
              );
              break;

            case "tool_execution_end":
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === `tool-${event.toolCallId}`
                    ? {
                        ...msg,
                        toolStatus: event.isError ? ("error" as const) : ("done" as const),
                        toolResult: extractTextFromResult(event.result),
                        toolError: event.isError ? extractToolError(event.result) : undefined,
                      }
                    : msg,
                ),
              );
              break;

            case "agent_end":
              setMode("idle");
              saveSession(event.messages as any[]);
              break;
          }
        });

      setMode("idle");
    })();

    return () => {
      agentRef.current?.abort();
    };
  }, []);

  const addMessage = useCallback((role: MessageProps["role"], content: string) => {
    const msg: MessageProps = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
    };
    setMessages((prev) => [...prev, msg]);
    return msg;
  }, []);

  const handleSubmit = useCallback(
    async (input: string) => {
      addMessage("user", input);

      if (input === "/exit" || input === "/quit") {
        addMessage("system", "Goodbye.");
        setTimeout(() => exit(), 300);
        return;
      }

      if (input === "/clear") {
        setMessages([]);
        agentRef.current?.reset();
        return;
      }

      if (input === "/config" || input === "/setup" || input === "/portfolio") {
        setConfigOpen(true);
        return;
      }

      if (input === "/help") {
        addMessage("system", helpText);
        return;
      }

      setMode("running");
      try {
        const parsed = parseCommand(input);
        if (parsed) {
          const result = await executeCommand(parsed);
          if (result.success) {
            addMessage("system", result.message);
          } else {
            addMessage("error", result.message);
          }
          if (parsed.flags["symbol"] || parsed.flags["code"]) {
            const sym = String(parsed.flags["symbol"] || parsed.flags["code"]);
            setLastSymbol(sym);
            updateSessionCtx({ lastSymbol: sym, lastMarket: String(parsed.flags["market"] || parsed.flags["m"] || "A") });
          }
          setMode("idle");
        } else if (agentRef.current) {
          const ctxInput = injectContext(input);
          await agentRef.current.prompt(ctxInput);
        } else {
          addMessage("system", "Initializing... please wait a moment.");
        }
      } catch (err) {
        addMessage("error", err instanceof Error ? err.message : String(err));
        setMode("idle");
      }
    },
    [addMessage, exit],
  );

  const terminalWidth = stdout?.columns ?? 100;
  const rootPaddingX = 2;
  const mainRightMargin = 2;
  const minMainWidth = 40;
  const showSidebar = terminalWidth >= rootPaddingX + mainRightMargin + SIDEBAR_WIDTH + minMainWidth;
  const mainWidth = Math.max(
    24,
    terminalWidth - rootPaddingX - (showSidebar ? SIDEBAR_WIDTH + mainRightMargin : 0),
  );

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box flexDirection="row" flexGrow={1}>
        <Box
          flexDirection="column"
          width={mainWidth}
          flexGrow={0}
          flexShrink={1}
          marginRight={showSidebar ? mainRightMargin : 0}
        >
          {configOpen ? (
            <ConfigPanel
              onDone={() => setConfigOpen(false)}
              onAction={(cmd) => {
                setConfigOpen(false);
                setTimeout(() => handleSubmit(cmd), 50);
              }}
            />
          ) : (
            <>
              <Conversation messages={messages} width={mainWidth} />
              <Input onSubmit={handleSubmit} disabled={mode === "running"} width={mainWidth} />
            </>
          )}
        </Box>

        {showSidebar ? <Sidebar mcpStatuses={mcpStatuses} /> : null}
      </Box>

      <StatusBar />
    </Box>
  );
}

// ── helpers ──

function extractToolError(result: unknown): string {
  if (!result || typeof result !== "object") return "Tool execution failed";
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content)) {
    const first = (r.content as Array<Record<string, unknown>>)[0];
    return String(first?.text ?? "Tool execution failed");
  }
  return "Tool execution failed";
}

function extractTextFromResult(result: unknown): string {
  if (!result) return "";
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content)) {
    return (r.content as Array<{ text?: string }>)
      .filter((c) => c.text)
      .map((c) => c.text!)
      .join("\n");
  }
  if (typeof r.text === "string") return r.text;
  return typeof result === "string" ? result : "";
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
  "No / prefix → AI analysis.",
].join("\n");
