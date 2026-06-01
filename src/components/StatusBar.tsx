import React from "react";
import { Box, Text } from "ink";

interface StatusBarProps {
  lastSymbol?: string | null;
  mode?: string;
}

export function StatusBar({ lastSymbol, mode = "idle" }: StatusBarProps) {
  const marker = mode === "running" ? "…" : mode === "error" ? "✗" : "●";
  const color = mode === "running" ? "yellow" : mode === "error" ? "red" : "green";

  return (
    <Box justifyContent="space-between" marginTop={1}>
      <Text dimColor>{lastSymbol || "—"}</Text>
      <Text color={color}>{marker}</Text>
    </Box>
  );
}
