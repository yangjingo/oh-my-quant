import React from "react";
import { Box, Text } from "ink";

interface TableProps {
  headers: string[];
  rows: string[][];
}

export function Table({ headers, rows }: TableProps) {
  if (headers.length === 0) return null;

  // Calculate column widths
  const widths = headers.map((h, i) => {
    let max = h.length;
    for (const row of rows) {
      max = Math.max(max, (row[i] || "").length);
    }
    return max + 2;
  });

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Header */}
      <Box>
        {headers.map((h, i) => (
          <Box key={i} width={widths[i]}>
            <Text bold>{h.padEnd(widths[i] - 1)}</Text>
          </Box>
        ))}
      </Box>
      {/* Separator */}
      <Text dimColor>{"─".repeat(widths.reduce((a, b) => a + b, 0))}</Text>
      {/* Rows */}
      {rows.map((row, ri) => (
        <Box key={ri}>
          {row.map((cell, ci) => (
            <Box key={ci} width={widths[ci]}>
              <Text>{cell.padEnd(widths[ci] - 1)}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
