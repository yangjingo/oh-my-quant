import React from "react";
import { Box, Text } from "ink";

interface StatusBarProps {
  lastSymbol?: string | null;
  mode?: string;
}

export function StatusBar({ lastSymbol, mode = "idle" }: StatusBarProps) {
  const modeLabel = mode === "running" ? "…" : mode === "error" ? "✗" : "✓";
  const modeColor = mode === "running" ? "yellow" : mode === "error" ? "red" : "green";

  return (
    <Box justifyContent="space-between" marginTop={1}>
      <Text dimColor>
        {lastSymbol || "—"}
      </Text>
      <Box>
        <Text color={modeColor}>{modeLabel}</Text>
        <Text dimColor>  /help · ctrl+c:quit</Text>
      </Box>
    </Box>
  );
}
