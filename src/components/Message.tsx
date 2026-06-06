import React from "react";
import { Box, Text } from "ink";
import { ThinkingPanel } from "./ThinkingPanel.tsx";
import { ToolCallInline } from "./ToolCall.tsx";
import { StreamCursor } from "./AnimatedText.tsx";
import { GOLD } from "../tui/tokens.ts";

export interface MessageProps {
  id?: string;
  role: "user" | "system" | "error" | "tool" | "thinking";
  content: string;
  thinking?: string;
  thinkingDone?: boolean;
  timestamp?: string;
  data?: { headers: string[]; rows: string[][] };
  width?: number;
  // tool-specific fields (when role === "tool")
  toolStatus?: "running" | "done" | "error";
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  toolError?: string;
  toolPartial?: string;
}

export function Message({ role, content, thinking, thinkingDone, width, toolStatus, toolArgs, toolResult, toolError, toolPartial }: MessageProps) {
  if (!content && !thinking && role !== "tool") return null;

  const showThinking = thinking && thinking.trim();
  const isStreaming = !!(showThinking && !thinkingDone && !content);

  if (role === "user") {
    return (
      <Box flexDirection="column" marginBottom={1} width={width}>
        <Box>
          <Text color={GOLD} bold>{"> "}</Text>
          <Text wrap="wrap">{content}</Text>
        </Box>
      </Box>
    );
  }

  if (role === "error") {
    return (
      <Box flexDirection="column" marginBottom={1} width={width}>
        <Box>
          <Text color={GOLD}>ERR </Text>
          <Text wrap="wrap">{content}</Text>
        </Box>
      </Box>
    );
  }

  if (role === "tool") {
    return (
      <ToolCallInline
        name={content}
        args={toolArgs ?? {}}
        status={toolStatus ?? "running"}
        result={toolResult}
        error={toolError}
        partial={toolPartial}
      />
    );
  }

  // system / assistant
  const contentLines = content ? content.split("\n") : [];

  return (
    <Box flexDirection="column" marginBottom={1} width={width}>
      {showThinking && <ThinkingPanel thinking={thinking} done={thinkingDone} streaming={isStreaming} />}
      {contentLines.length > 0 ? (
        <Box flexDirection="column">
          {contentLines.map((line, i) => (
            <Box key={i}>
              <Text wrap="wrap">{line || " "}</Text>
              {i === contentLines.length - 1 && isStreaming ? (
                <StreamCursor active={isStreaming} />
              ) : null}
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
