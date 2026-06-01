import React from "react";
import { Box, Text } from "ink";

interface HeaderProps {
  mcpStatus: string[];
}

export function Header({ mcpStatus }: HeaderProps) {
  const connected = mcpStatus.length > 0;

  return (
    <Box justifyContent="space-between" marginBottom={1}>
      <Box>
        <Text color="yellow" bold>▊ </Text>
        <Text bold>WhyJ</Text>
      </Box>
      {connected ? (
        <Text dimColor>{mcpStatus.length} source{mcpStatus.length > 1 ? "s" : ""}</Text>
      ) : (
        <Text dimColor>offline</Text>
      )}
    </Box>
  );
}
