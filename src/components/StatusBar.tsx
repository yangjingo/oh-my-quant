import React from "react";
import { Box, Text, useStdout } from "ink";

export function StatusBar() {
  const { stdout } = useStdout();
  const w = (stdout?.columns ?? 80) - 2;
  return (
    <Box marginTop={1}>
      <Text dimColor>{"-".repeat(Math.max(1, w))}</Text>
    </Box>
  );
}
