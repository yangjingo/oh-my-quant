import React from "react";
import { Box, Text } from "ink";

interface HeaderProps {
  mcpStatus: string[];
}

export function Header({ mcpStatus }: HeaderProps) {
  const connected = mcpStatus.length > 0;

  return (
    <Box justifyContent="space-between" marginBottom={1}>
      <Text bold>WhyJ</Text>
      {connected ? (
        <Text dimColor>{mcpStatus.length} source{mcpStatus.length > 1 ? "s" : ""}</Text>
      ) : (
        <Text dimColor>offline</Text>
      )}
    </Box>
  );
}
