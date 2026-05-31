import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import { Header } from "./components/Header.tsx";
import { Conversation } from "./components/Conversation.tsx";
import { Input } from "./components/Input.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { Table } from "./components/Table.tsx";
import type { MessageProps } from "./components/Message.tsx";
import { parseCommand, executeCommand, type ParsedCommand } from "./commands/registry.ts";
import { ensureDirs, loadConfig } from "./storage/index.ts";
import { connectAll, getConnectedServers } from "./data/mcp-client.ts";

export function App() {
  const { exit } = useApp();
  const [messages, setMessages] = useState<MessageProps[]>([
    { role: "system", content: "WhyJ Quant · interactive terminal", id: "welcome" },
    { role: "system", content: "Type /help for commands, or ask a question in natural language.", id: "hint" },
  ]);
  const [mode, setMode] = useState<string>("loading");
  const [lastSymbol, setLastSymbol] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  const [streamingText, setStreamingText] = useState("");

  // Initialize storage and MCP
  useEffect(() => {
    void (async () => {
      try {
        ensureDirs();
        loadConfig();
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
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => [...prev, msg]);
    return msg;
  }, []);

  const handleSubmit = useCallback(
    async (input: string) => {
      addMessage("user", input);

      if (input === "/exit" || input === "/quit") {
        exit();
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

      setMode("running");
      try {
        const parsed = parseCommand(input);
        if (parsed) {
          const result = await executeCommand(parsed);
          if (result.success) {
            addMessage("system", result.message);
            if (result.data && result.renderAs === "table") {
              // Table rendering handled by data
              const data = result.data as { headers: string[]; rows: string[][] };
              setMessages((prev) => [
                ...prev,
                { id: `table-${Date.now()}`, role: "system", content: "", data },
              ]);
            }
          } else {
            addMessage("error", result.message);
          }
          if (parsed.flags["symbol"]) {
            setLastSymbol(String(parsed.flags["symbol"]));
          }
        } else {
          addMessage("system", `Unknown command. Type /help for available commands.\nYou said: ${input}`);
        }
      } catch (err) {
        addMessage("error", err instanceof Error ? err.message : String(err));
      }
      setMode("idle");
      setStreamingText("");
    },
    [addMessage, exit],
  );

  return (
    <Box flexDirection="column" padding={1} minHeight={20}>
      <Header mcpStatus={mcpServers} />
      <Conversation messages={messages} />
      {streamingText ? (
        <Box marginBottom={1}>
          <Text>{streamingText}</Text>
          <Text dimColor>█</Text>
        </Box>
      ) : null}
      <Input onSubmit={handleSubmit} disabled={mode === "running"} />
      <StatusBar lastSymbol={lastSymbol} mode={mode} />
    </Box>
  );
}

const helpText = `
Available commands:

  /data download    Download OHLCV data
    --symbol CODE   Stock code (e.g. 000001.SZ, AAPL)
    --market A|US   Market (default: A)
    --start DATE    Start date YYYY-MM-DD
    --end DATE      End date YYYY-MM-DD

  /data search      Search symbols
    --keyword KW    Search keyword

  /factor list      List available factors
  /factor analyze   Compute factor
    --symbol CODE
    --factor NAME   momentum|reversal|volatility|volume_ratio|rsi|sma_deviation
    --period N      (default: 20)

  /backtest run     Run SMA crossover backtest
    --symbol CODE
    --fast N        Fast SMA period (default: 20)
    --slow N        Slow SMA period (default: 60)
    --cash N        Initial cash (default: 100000)

  /risk check       Compute risk metrics
    --symbol CODE

  /benchmark run    Run strategy scoring
    --symbol CODE   (uses defaults for other params)
  /benchmark dashboard  Show all benchmark results

  /portfolio capture    Capture today's NAV
  /portfolio review     Review recent NAV

  /mcp connect      Connect to MCP servers
  /mcp status       Show MCP connection status

  /help             Show this help
  /clear            Clear conversation
  /exit             Exit
`;
