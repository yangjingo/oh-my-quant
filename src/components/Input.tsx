import React, { useState, useMemo } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";

interface InputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

const COMMANDS: { name: string; desc: string; usage: string }[] = [
  { name: "/claw",      desc: "Stock snapshot",                         usage: "/claw --code CODE [--market A|US]" },
  { name: "/skill",     desc: "List or trigger skills",                 usage: "/skill list" },
  { name: "/add",       desc: "Manage watchlist",                       usage: "/add stock --code CODE --name NAME" },
  { name: "/config",    desc: "Interactive settings",                   usage: "/config" },
  { name: "/benchmark", desc: "Strategy scoring dashboard",             usage: "/benchmark dashboard" },
  { name: "/mcp",       desc: "Connect to data servers",                usage: "/mcp connect" },
  { name: "/help",      desc: "Show all commands",                      usage: "/help" },
  { name: "/clear",     desc: "Clear conversation",                     usage: "/clear" },
  { name: "/exit",      desc: "Exit WhyJ Quant",                        usage: "/exit" },
];

export function Input({ onSubmit, disabled }: InputProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [cursor, setCursor] = useState(0);

  const suggestions = useMemo(() => {
    if (!value || value.startsWith(" ") || !value.startsWith("/")) return [];
    const lower = value.toLowerCase();
    return COMMANDS.filter((c) => c.name.toLowerCase().startsWith(lower));
  }, [value]);

  const hasSuggestions = suggestions.length > 0;

  useInput((input, key) => {
    if (disabled) return;

    // With suggestions visible: ↑↓ navigates suggestions, ↵/tab selects
    if (hasSuggestions) {
      if (key.upArrow) {
        setCursor((c) => (c > 0 ? c - 1 : suggestions.length - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => (c < suggestions.length - 1 ? c + 1 : 0));
        return;
      }
      if (key.return) {
        const chosen = suggestions[cursor % suggestions.length].usage;
        setHistory((h) => [chosen, ...h].slice(0, 100));
        onSubmit(chosen);
        setValue("");
        setCursor(0);
        return;
      }
      if (key.tab) {
        setValue(suggestions[cursor % suggestions.length].usage);
        setCursor(0);
        return;
      }
      if (key.escape) {
        setValue("");
        setCursor(0);
        return;
      }
    }

    // No suggestions: ↑↓ navigates history
    if (!hasSuggestions) {
      if (key.upArrow) {
        const idx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(idx);
        if (history[idx]) setValue(history[idx]);
        return;
      }
      if (key.downArrow) {
        const idx = Math.max(historyIdx - 1, -1);
        setHistoryIdx(idx);
        setValue(idx >= 0 ? history[idx] : "");
        return;
      }
    }

    // Submit
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) {
        setHistory((h) => [trimmed, ...h].slice(0, 100));
        onSubmit(trimmed);
        setValue("");
        setHistoryIdx(-1);
        setCursor(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      setCursor(0);
    } else if (key.escape) {
      setValue("");
      setCursor(0);
    } else if (input.length > 0 && !key.ctrl) {
      setValue((v) => v + input);
      setCursor(0);
    }
  });

  return (
    <Box flexDirection="column">
      {hasSuggestions && (
        <Box flexDirection="column" marginBottom={1}>
          {suggestions.map((s, i) => (
            <Box key={s.name}>
              <Text color={i === cursor ? "yellow" : undefined}>
                {i === cursor ? "❯ " : "  "}
              </Text>
              <Text bold color={i === cursor ? "yellow" : undefined}>
                {s.name}
              </Text>
              <Text dimColor>  {s.desc}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box>
        <Text color="yellow" bold>› </Text>
        <Text>{value}</Text>
        <Text dimColor>│</Text>
      </Box>
    </Box>
  );
}
