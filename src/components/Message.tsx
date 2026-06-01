import React from "react";
import { Box, Text } from "ink";

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
        <Text color="yellow" bold>› </Text>
        <Text>{content}</Text>
      </Box>
    );
  }

  if (role === "error") {
    return (
      <Box marginBottom={1}>
        <Text color="red">✗ {content}</Text>
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
