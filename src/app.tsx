import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import { Header } from "./components/Header.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Conversation } from "./components/Conversation.tsx";
import { Input } from "./components/Input.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import type { MessageProps } from "./components/Message.tsx";
import { parseCommand, executeCommand } from "./commands/registry.ts";
import { ensureDirs, loadSettings } from "./storage/index.ts";
import { connectAll, getConnectedServers } from "./data/mcp-client.ts";

export function App() {
  const { exit } = useApp();
  const [messages, setMessages] = useState<MessageProps[]>([
    { role: "system", content: "Welcome to WhyJ Quant. Type / for commands, or ask a question.", id: "welcome" },
  ]);
  const [mode, setMode] = useState<string>("loading");
  const [lastSymbol, setLastSymbol] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        ensureDirs();
        loadSettings();
        const servers = await connectAll();
        setMcpServers(servers.length > 0 ? getConnectedServers() : []);
      } catch {
        setMcpServers([]);
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
        return;
      }

      if (input === "/help") {
        addMessage("system", helpText);
        return;
      }

      if (input === "/sidebar") {
        // built-in toggle — handled via component state in future
        addMessage("system", "Sidebar tabs: Market · Data · Portfolio");
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
            setLastSymbol(String(parsed.flags["symbol"] || parsed.flags["code"]));
          }
        } else {
          addMessage("system", "Unknown command. Type / to browse commands, or ask a question naturally.");
        }
      } catch (err) {
        addMessage("error", err instanceof Error ? err.message : String(err));
      }
      setMode("idle");
    },
    [addMessage, exit],
  );

  const sidebarWidth = 26;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header mcpStatus={mcpServers} />

      <Box flexDirection="row" flexGrow={1}>
        {/* Main area */}
        <Box flexDirection="column" flexGrow={1} marginRight={1}>
          <Conversation messages={messages} />
          <Input onSubmit={handleSubmit} disabled={mode === "running"} />
        </Box>

        {/* Sidebar */}
        <Sidebar
          mcpServers={mcpServers}
          lastSymbol={lastSymbol}
          width={sidebarWidth}
        />
      </Box>

      <StatusBar lastSymbol={lastSymbol} mode={mode} />
    </Box>
  );
}

const helpText = [
  "Commands:",
  "",
  "  /claw      Stock snapshot     /claw --code 000001.SZ",
  "  /skill     Trigger skills     /skill trigger --name fetch_bars --code CODE",
  "  /add       Watchlist          /add stock --code CODE --name NAME",
  "  /config    Settings           /config show",
  "  /benchmark  Strategy scores   /benchmark dashboard",
  "  /mcp        Data servers      /mcp connect",
  "  /help  /clear  /exit  /sidebar",
  "",
  "No / prefix → natural language question.",
].join("\n");
