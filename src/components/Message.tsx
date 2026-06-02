import React from "react";
import { Box, Text } from "ink";
import { GOLD } from "../tui/tokens.ts";

export interface MessageProps {
  id?: string;
  role: "user" | "system" | "error";
  content: string;
  timestamp?: string;
  data?: { headers: string[]; rows: string[][] };
}

export function Message({ role, content, timestamp }: MessageProps) {
  if (!content && role === "system") return null;

  if (role === "user") {
    return (
      <Box marginBottom={1}>
        <Text color={GOLD} bold>{"> "}</Text>
        <Text>{content}</Text>
      </Box>
    );
  }

  if (role === "error") {
    return (
      <Box marginBottom={1}>
        <Text color={GOLD}>ERR </Text>
        <Text>{content}</Text>
      </Box>
    );
  }

  // system / assistant
  return (
    <Box flexDirection="column" marginBottom={1}>
      {content.split("\n").map((line, i) => (
        <Box key={i}>
          <Text>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}
