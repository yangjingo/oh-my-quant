import React from "react";
import { Box, Text } from "ink";

export interface MessageProps {
  id?: string;
  role: "user" | "system" | "error";
  content: string;
  timestamp?: string;
}

export function Message({ role, content, timestamp }: MessageProps) {
  const prefix = role === "user" ? "Q > " : role === "error" ? "✗ " : "  ";
  const color = role === "user" ? "cyan" : role === "error" ? "red" : "white";

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={color} bold>
          {prefix}
        </Text>
        <Text color={color}>{content}</Text>
      </Box>
      {timestamp && (
        <Text dimColor>
          {"  "}
          {timestamp}
        </Text>
      )}
    </Box>
  );
}
