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
        <Text bold color="cyan">WhyJ Quant</Text>
        <Text dimColor>  ·  data  factor  backtest  risk  benchmark</Text>
      </Box>
      <Box>
        <Text color={connected ? "green" : "yellow"}>
          {connected ? `mcp: ${mcpStatus.join(", ")}` : "mcp: disconnected"}
        </Text>
      </Box>
    </Box>
  );
}
