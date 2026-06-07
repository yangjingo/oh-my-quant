import React, { useEffect, useRef, useState } from "react";
import { Box, useApp, useStdout } from "ink";
import { AppRuntime } from "./app-runtime.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { ConfigPanel } from "./components/ConfigPanel.tsx";
import { Conversation } from "./components/Conversation.tsx";
import { Input } from "./components/Input.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import type { MessageProps } from "./components/Message.tsx";
import { SIDEBAR_WIDTH } from "./tui/tokens.ts";
import type { McpServerStatus } from "./data/mcp-client.ts";
import type { UIMessage } from "./tui/types.ts";

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const runtimeRef = useRef<AppRuntime | null>(null);
  const [messages, setMessages] = useState<MessageProps[]>([]);
  const [mode, setMode] = useState<"starting" | "thinking" | "running tool" | "ready">("starting");
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [configOpen, setConfigOpen] = useState(false);

  useEffect(() => {
    const runtime = new AppRuntime({
      onMessages: (nextMessages) => setMessages(nextMessages.map(toMessageProps)),
      onActivity: (activity) => setMode(activity),
      onConfigRequest: () => setConfigOpen(true),
    });
    runtimeRef.current = runtime;

    void runtime.init()
      .then((snapshot) => {
        setMcpStatuses(snapshot.mcpStatuses);
      })
      .catch((err) => {
        setMessages([
          {
            id: "runtime-init-error",
            role: "error",
            content: err instanceof Error ? err.message : String(err),
          },
        ]);
        setMode("ready");
      });

    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  const handleSubmit = async (input: string) => {
    const result = await runtimeRef.current?.submit(input);
    if (result === "exit") {
      setTimeout(() => exit(), 100);
    }
  };

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
                setTimeout(() => {
                  void handleSubmit(cmd);
                }, 50);
              }}
            />
          ) : (
            <>
              <Conversation messages={messages} width={mainWidth} />
              <Input onSubmit={(value) => void handleSubmit(value)} disabled={mode === "running tool"} width={mainWidth} />
            </>
          )}
        </Box>

        {showSidebar ? <Sidebar mcpStatuses={mcpStatuses} /> : null}
      </Box>

      <StatusBar />
    </Box>
  );
}

function toMessageProps(message: UIMessage): MessageProps {
  if (message.role === "tool" && message.tool) {
    return {
      id: `${message.tool.name}-${message.tool.startedAt}`,
      role: "tool",
      content: message.tool.name,
      toolArgs: message.tool.args ? { value: message.tool.args } : {},
      toolStatus: message.tool.status,
      toolResult: message.tool.status === "error" ? undefined : message.tool.result,
      toolError: message.tool.status === "error" ? message.tool.result : undefined,
      toolPartial: message.tool.status === "running" ? message.tool.result : undefined,
    };
  }

  if (message.role === "thinking") {
    return {
      id: `thinking-${hashText(message.text ?? "")}`,
      role: "thinking",
      content: "",
      thinking: message.text ?? "",
      thinkingDone: true,
    };
  }

  return {
    id: `${message.role}-${hashText(message.text ?? "")}`,
    role: message.role === "assistant" ? "system" : message.role,
    content: message.text ?? "",
  };
}

function hashText(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}
