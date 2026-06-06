import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useStdout } from "ink";
import { loadLocalModel } from "../tui/local-snapshot.ts";
import { DIVIDER_CHAR, GOLD } from "../tui/tokens.ts";

export function StatusBar() {
  const { stdout } = useStdout();
  const w = (stdout?.columns ?? 80) - 2;
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadLocalModel().then((loadedModel) => {
      if (!active) return;
      setModel(loadedModel);
    });
    return () => { active = false; };
  }, []);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{DIVIDER_CHAR.repeat(Math.max(1, w))}</Text>
      <Box>
        <Text dimColor>{model ?? "loading model"}</Text>
        <Text dimColor> · .ohquant </Text>
        <Text color={GOLD}>market-cache only</Text>
        <Text dimColor> · portfolio live-only</Text>
      </Box>
    </Box>
  );
}

// ── Processing dot animation (used inline for idle status) ──

const DOT_FRAMES = ["", ".", "..", "..."];

export function ProcessingDots() {
  const [frame, setFrame] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    ref.current = setInterval(() => setFrame((f) => (f + 1) % 4), 300);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, []);

  return <Text color={GOLD}>{DOT_FRAMES[frame]}</Text>;
}
