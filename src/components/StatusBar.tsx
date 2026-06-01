import React from "react";
import { Box, Text } from "ink";

interface StatusBarProps {
  lastSymbol?: string | null;
  mode?: string;
}

export function StatusBar({ lastSymbol, mode = "idle" }: StatusBarProps) {
  const modeColor = mode === "running" ? "yellow" : mode === "error" ? "red" : "green";
  return (
    <Box justifyContent="space-between" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor>
        {lastSymbol ? `symbol: ${lastSymbol}` : "no symbol"}
      </Text>
      <Text color={modeColor}>{mode}</Text>
      <Text dimColor>ctrl+c:quit | /help</Text>
    </Box>
  );
}
