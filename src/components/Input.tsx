import React, { useState, useMemo } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";

interface InputProps {
  prompt?: string;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

const COMMANDS: { name: string; desc: string; usage: string }[] = [
  { name: "/claw",     desc: "Stock snapshot",                          usage: "/claw --code CODE [--market A|US]" },
  { name: "/skill",    desc: "List or trigger skills",                  usage: "/skill trigger --name NAME --code CODE" },
  { name: "/add",      desc: "Manage watchlist",                        usage: "/add stock --code CODE --name NAME" },
  { name: "/config",   desc: "Configure API keys and model",            usage: "/config show" },
  { name: "/benchmark",desc: "Strategy scoring dashboard",              usage: "/benchmark dashboard" },
  { name: "/mcp",      desc: "Connect to data servers",                 usage: "/mcp connect" },
  { name: "/help",     desc: "Show all commands",                       usage: "/help" },
  { name: "/clear",    desc: "Clear conversation",                      usage: "/clear" },
  { name: "/exit",     desc: "Exit WhyJ Quant",                          usage: "/exit" },
];

export function Input({ onSubmit, disabled }: InputProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [suggestionIdx, setSuggestionIdx] = useState(0);

  const suggestions = useMemo(() => {
    if (!value || value.startsWith(" ") || !value.startsWith("/")) return [];
    const lower = value.toLowerCase();
    return COMMANDS.filter((c) => c.name.toLowerCase().startsWith(lower));
  }, [value]);

  useInput((input, key) => {
    if (disabled) return;

    // Tab: cycle through suggestions or auto-complete
    if (key.tab && suggestions.length > 0) {
      const idx = suggestionIdx % suggestions.length;
      setValue(suggestions[idx].usage);
      setSuggestionIdx((prev) => prev + 1);
      return;
    }

    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) {
        setHistory((h) => [trimmed, ...h].slice(0, 100));
        onSubmit(trimmed);
        setValue("");
        setHistoryIdx(-1);
        setSuggestionIdx(0);
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
      setSuggestionIdx(0);
    } else if (key.escape) {
      setValue("");
      setSuggestionIdx(0);
    } else if (input.length > 0 && !key.ctrl) {
      setValue((v) => v + input);
      setSuggestionIdx(0);
    }
  });

  return (
    <Box flexDirection="column">
      {suggestions.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text dimColor>  suggestions:</Text>
          </Box>
          {suggestions.map((s, i) => (
            <Box key={s.name}>
              {i === suggestionIdx % suggestions.length ? (
                <Text color="cyan">  › </Text>
              ) : (
                <Text dimColor>    </Text>
              )}
              <Text bold color={i === suggestionIdx % suggestions.length ? "cyan" : undefined}>
                {s.name}
              </Text>
              <Text dimColor>  {s.desc}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box>
        <Text color="cyan" bold>
          Q ›{" "}
        </Text>
        <Text>{value}</Text>
        <Text dimColor>│</Text>
      </Box>
    </Box>
  );
}
