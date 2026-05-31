import React from "react";
import { Box, Text } from "ink";

interface HeaderProps {
  mcpStatus: string[];
  version?: string;
}

export function Header({ mcpStatus, version = "2.0.0" }: HeaderProps) {
  const connected = mcpStatus.length > 0;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          WhyJ Quant
        </Text>
        <Text dimColor>
          v{version}
        </Text>
      </Box>
      <Box>
        <Text dimColor>
          data · factor · backtest · risk · benchmark · portfolio
        </Text>
      </Box>
      <Box>
        <Text color={connected ? "green" : "yellow"}>
          MCP: {connected ? mcpStatus.join(", ") : "disconnected — run /mcp connect"}
        </Text>
      </Box>
    </Box>
  );
}
