import React, { useState } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";

interface InputProps {
  prompt?: string;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function Input({ prompt = "Q > ", onSubmit, disabled }: InputProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  useInput((input, key) => {
    if (disabled) return;

    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) {
        setHistory((h) => [trimmed, ...h].slice(0, 100));
        onSubmit(trimmed);
        setValue("");
        setHistoryIdx(-1);
      }
    } else if (key.upArrow) {
      const newIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(newIdx);
      if (history[newIdx]) setValue(history[newIdx]);
    } else if (key.downArrow) {
      const newIdx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(newIdx);
      setValue(newIdx >= 0 ? history[newIdx] : "");
    } else if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
    } else if (input.length > 0 && !key.ctrl) {
      setValue((v) => v + input);
    }
  });

  return (
    <Box>
      <Text color="cyan" bold>
        {prompt}
      </Text>
      <Text>{value}</Text>
      <Text dimColor>█</Text>
    </Box>
  );
}
