import React from "react";
import { Box, Text } from "ink";
import { GOLD } from "../tui/tokens.ts";

export interface MessageProps {
  id?: string;
  role: "user" | "system" | "error" | "tool" | "thinking";
  content: string;
  thinking?: string;
  timestamp?: string;
  data?: { headers: string[]; rows: string[][] };
  width?: number;
}

export function Message({ role, content, thinking, timestamp, width }: MessageProps) {
  void timestamp;
  if (!content && !thinking && role === "system") return null;

  if (role === "user") {
    return (
      <Box marginBottom={1} width={width}>
        <Text color={GOLD} bold>{"> "}</Text>
        <Text wrap="wrap">{content}</Text>
      </Box>
    );
  }

  if (role === "error") {
    return (
      <Box marginBottom={1} width={width}>
        <Text color={GOLD}>ERR </Text>
        <Text wrap="wrap">{content}</Text>
      </Box>
    );
  }

  if (role === "tool") {
    return (
      <Box marginBottom={1} width={width}>
        <Text dimColor>{"[tool] "}</Text>
        <Text dimColor wrap="wrap">{content}</Text>
      </Box>
    );
  }

  if (role === "thinking") {
    return (
      <Box flexDirection="column" marginBottom={1} width={width}>
        {thinking?.split("\n").map((line, i) => (
          <Box key={i}>
            <Text dimColor wrap="wrap">{line || " "}</Text>
          </Box>
        ))}
      </Box>
    );
  }

  // system / assistant
  return (
    <Box flexDirection="column" marginBottom={1} width={width}>
      {thinking ? (
        <Box flexDirection="column" marginBottom={1}>
          {thinking.split("\n").map((line, i) => (
            <Box key={i}>
              <Text dimColor wrap="wrap">{line || " "}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
      {content ? content.split("\n").map((line, i) => (
        <Box key={i}>
          <Text wrap="wrap">{line}</Text>
        </Box>
      )) : null}
    </Box>
  );
}
