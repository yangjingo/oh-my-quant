import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, useApp } from "ink";
import { Sidebar } from "./components/Sidebar.tsx";
import { ConfigPanel } from "./components/ConfigPanel.tsx";
import { Conversation } from "./components/Conversation.tsx";
import { Input } from "./components/Input.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import type { MessageProps } from "./components/Message.tsx";
import { parseCommand, executeCommand } from "./commands/registry.ts";
import { ensureDirs, loadSettings } from "./storage/index.ts";
import { connectAll, getServerStatus, type McpServerStatus } from "./data/mcp-client.ts";
import { createAgent } from "./agent/session.ts";
import type { Agent } from "@earendil-works/pi-agent-core";

export function App() {
  const { exit } = useApp();
  const [messages, setMessages] = useState<MessageProps[]>([]);
  const [mode, setMode] = useState<string>("loading");
  const [lastSymbol, setLastSymbol] = useState<string | null>(null);
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [configOpen, setConfigOpen] = useState(false);
  const agentRef = useRef<Agent | null>(null);
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

      // Init agent
      try {
        const agent = createAgent();
        agentRef.current = agent;

        // Subscribe to agent events → update TUI messages
        agent.subscribe(async (event) => {
          switch (event.type) {
            case "message_start": {
              const m = event.message;
              if (m.role === "assistant" && m.content?.length > 0) {
                const id = `agent-${Date.now()}`;
                streamingIdRef.current = id;
                setMessages((prev) => [...prev, { id, role: "system", content: "..." }]);
              }
              break;
            }
            case "message_update": {
              const m = event.message;
              if (m.role === "assistant" && streamingIdRef.current) {
                const text = m.content
                  .filter((c: unknown) => (c as { type: string }).type === "text")
                  .map((c: unknown) => (c as { text: string }).text)
                  .join("");
                setMessages((prev) => prev.map((msg) =>
                  msg.id === streamingIdRef.current ? { ...msg, content: text || "..." } : msg
                ));
              }
              break;
            }
            case "message_end": {
              const m = event.message;
              if (m.role === "assistant" && streamingIdRef.current) {
                const text = m.content
                  .filter((c: unknown) => (c as { type: string }).type === "text")
                  .map((c: unknown) => (c as { text: string }).text)
                  .join("");
                setMessages((prev) => prev.map((msg) =>
                  msg.id === streamingIdRef.current ? { ...msg, content: text || "(empty)" } : msg
                ));
                streamingIdRef.current = null;
              }
              break;
            }
            case "tool_execution_start":
              setMode("running");
              setMessages((prev) => [...prev, {
                id: `tool-${event.toolCallId}`,
                role: "system",
                content: `Running ${event.toolName}...`,
              }]);
              break;
            case "tool_execution_end":
              if (!event.isError) break;
              setMessages((prev) => [...prev, {
                id: `tool-err-${event.toolCallId}`,
                role: "error",
                content: String(event.result?.content?.[0]?.text || "Tool error"),
              }]);
              break;
            case "agent_end":
              setMode("idle");
              break;
          }
        });
      } catch {
        // Agent not available (no API key) — natural language disabled
      }

      setMode("idle");
    })();
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
          // Slash command — direct execution
          const result = await executeCommand(parsed);
          if (result.success) {
            addMessage("system", result.message);
          } else {
            addMessage("error", result.message);
          }
          if (parsed.flags["symbol"] || parsed.flags["code"]) {
            setLastSymbol(String(parsed.flags["symbol"] || parsed.flags["code"]));
          }
          setMode("idle");
        } else if (agentRef.current) {
          // Natural language — AI Agent
          try {
            await agentRef.current.prompt(input);
          } catch (err) {
            addMessage("error", `Agent: ${err instanceof Error ? err.message : String(err)}`);
            setMode("idle");
          }
        } else {
          addMessage("system", "Set Anthropic API key in /config to enable AI analysis.");
          setMode("idle");
        }
      } catch (err) {
        addMessage("error", err instanceof Error ? err.message : String(err));
        setMode("idle");
      }
    },
    [addMessage, exit],
  );

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box flexDirection="row" flexGrow={1}>
        <Box flexDirection="column" flexGrow={1} marginRight={2}>
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
              <Conversation messages={messages} />
              <Input onSubmit={handleSubmit} disabled={mode === "running"} />
            </>
          )}
        </Box>

        <Sidebar mcpStatuses={mcpStatuses} />
      </Box>

      <StatusBar />
    </Box>
  );
}

const helpText = [
  "Commands:",
  "",
  "  /claw      Stock snapshot     /claw --code 000001.SZ",
  "  /skill     Trigger skills     /skill trigger --name fetch_bars --code CODE",
  "  /add       Watchlist          /add stock --code CODE --name NAME",
  "  /portfolio Config portfolio   /portfolio add --code CODE",
  "  /config    Settings           /config",
  "  /benchmark Strategy scores    /benchmark dashboard",
  "  /mcp       Data servers       /mcp connect",
  "  /help  /clear  /exit",
  "",
  "No / prefix → AI analysis.",
].join("\n");
