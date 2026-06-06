import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { Spinner } from "./Spinner.tsx";
import { ProgressDots, ElapsedTimer, StreamCursor } from "./AnimatedText.tsx";
import { GOLD } from "../tui/tokens.ts";

interface ThinkingPanelProps {
  thinking: string;
  done?: boolean;
  streaming?: boolean;
}

export function ThinkingPanel({ thinking, done, streaming }: ThinkingPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const prevDone = useRef(false);
  const startMs = useRef(Date.now());

  useEffect(() => {
    if (done && !prevDone.current) setCollapsed(true);
    prevDone.current = done ?? false;
  }, [done]);

  if (!thinking.trim()) return null;

  const lines = thinking.trim().split("\n");

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        {done ? (
          <Text dimColor>[thinking done] </Text>
        ) : (
          <Box>
            <Spinner active={!done} variant="dots" color={GOLD} />
            <Text color={GOLD}> thinking</Text>
            <ProgressDots active={!done} />
          </Box>
        )}
        <Text dimColor> {collapsed ? "[+]" : "[-]"}</Text>
        {!done && <ElapsedTimer active={!done} startMs={startMs.current} />}
      </Box>
      {!collapsed && (
        <Box flexDirection="column" marginLeft={2}>
          {lines.map((line, i) => (
            <Box key={i}>
              <Text dimColor wrap="wrap">{line || " "}</Text>
              {streaming && i === lines.length - 1 ? <StreamCursor active={true} /> : null}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
