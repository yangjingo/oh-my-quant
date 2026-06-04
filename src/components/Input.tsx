import React, { useState, useMemo } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GOLD } from "../tui/tokens.ts";

interface InputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
  width?: number;
}

interface CmdAction {
  label: string;
  fill: string;
}

interface CmdDef {
  name: string; desc: string;
  actions?: CmdAction[];
}

const CMDS: CmdDef[] = [
  { name: "/claw", desc: "Snapshot fund info" },
  {
    name: "/skill", desc: "List or trigger skills",
    actions: [
      { label: "Show all skills", fill: "/skill" },
      { label: "Trigger a skill", fill: "/skill trigger " },
    ],
  },
  {
    name: "/watch", desc: "Manage fund watchlist",
    actions: [
      { label: "Show watchlist", fill: "/watch" },
      { label: "Add fund", fill: "/watch " },
      { label: "Remove fund", fill: "/watch remove " },
    ],
  },
  { name: "/portfolio", desc: "Open portfolio config" },
  { name: "/config", desc: "Interactive settings" },
  { name: "/benchmark", desc: "Strategy scoring dashboard" },
  {
    name: "/mcp", desc: "Connect to data servers",
    actions: [
      { label: "Show status", fill: "/mcp" },
      { label: "Connect all servers", fill: "/mcp connect" },
    ],
  },
  { name: "/help", desc: "Show all commands" },
  { name: "/clear", desc: "Clear conversation" },
  { name: "/exit", desc: "Exit WhyJ Quant" },
];

interface CodeEntry { code: string; name: string; }

function getWatchlist(): CodeEntry[] {
  try {
    const path = join(process.cwd(), ".ohquant", "watchlist.json");
    if (!existsSync(path)) return [];
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return raw.funds || [];
  } catch { return []; }
}

interface Suggestion { label: string; fill: string; }

export function Input({ onSubmit, disabled, width }: InputProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [cursor, setCursor] = useState(0);

  const watchlist = useMemo(() => getWatchlist(), []);

  const suggestions: Suggestion[] = useMemo(() => {
    if (!value || value.startsWith(" ")) return [];

    // Code autocomplete: after --code or --symbol flag
    const codeMatch = value.match(/^(.+--(code|symbol)\s+)(\S*)$/i);
    if (codeMatch) {
      const prefix = codeMatch[1];
      const partial = codeMatch[3].toLowerCase();
      if (!partial) return [];
      return watchlist
        .filter((c) => c.code.toLowerCase().includes(partial) || c.name.includes(partial))
        .map((c) => ({ label: `${c.code.split(".")[0]}  ${c.name}`, fill: prefix + c.code }));
    }

    // Name autocomplete: after --name flag
    const nameMatch = value.match(/^(.+--name\s+)(\S*)$/i);
    if (nameMatch) {
      const prefix = nameMatch[1];
      const partial = nameMatch[2].toLowerCase();
      if (!partial) return [];
      return watchlist
        .filter((c) => c.name.includes(partial))
        .map((c) => ({ label: c.name, fill: prefix + c.name }));
    }

    if (!value.startsWith("/")) return [];

    // Actions: show when a command name is typed exactly
    const exact = CMDS.find((c) => c.name === value && c.actions?.length);
    if (exact?.actions) {
      return exact.actions.map((a) => ({ label: a.label, fill: a.fill }));
    }

    // Command suggestions (e.g. "/por" → /portfolio)
    const lower = value.toLowerCase();
    return CMDS
      .filter((c) => c.name.toLowerCase().startsWith(lower))
      .map((c) => ({ label: `${c.name}  ${c.desc}`, fill: c.name }));
  }, [value, watchlist]);

  const hasSuggestions = suggestions.length > 0;

  function submit(fill: string) {
    setHistory((h) => [fill, ...h].slice(0, 100));
    // If fill ends with space, let user continue typing
    if (fill.endsWith(" ")) {
      setValue(fill);
      setCursor(0);
    } else {
      onSubmit(fill);
      setValue("");
      setCursor(0);
    }
  }

  useInput((input, key) => {
    if (disabled) return;

    if (hasSuggestions) {
      // Number keys 1-9: direct selection
      const num = parseInt(input, 10);
      if (num >= 1 && num <= Math.min(suggestions.length, 9)) {
        submit(suggestions[num - 1].fill);
        return;
      }
      if (key.upArrow) {
        setCursor((c) => (c > 0 ? c - 1 : suggestions.length - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => (c < suggestions.length - 1 ? c + 1 : 0));
        return;
      }
      if (key.return) {
        submit(suggestions[cursor % suggestions.length].fill);
        return;
      }
      if (key.tab) {
        submit(suggestions[cursor % suggestions.length].fill);
        return;
      }
      if (key.escape) {
        setValue("");
        setCursor(0);
        return;
      }
    }

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
    <Box flexDirection="column" width={width}>
      <Box width={width}>
        <Text color={GOLD} bold>{"> "}</Text>
        {value ? (
          <Text wrap="wrap">{value}</Text>
        ) : (
          <Text dimColor>ask a research question or type /</Text>
        )}
        <Text color={GOLD}>|</Text>
      </Box>
      {hasSuggestions && (
        <Box flexDirection="column" marginTop={1} width={width}>
          {suggestions.map((s, i) => (
            <Box key={s.label} width={width}>
              <Text color={i === cursor ? GOLD : undefined} dimColor={i !== cursor}>
                {String(i + 1).padStart(2)}.
              </Text>
              <Text bold color={i === cursor ? GOLD : undefined}>
                {" "}{s.label}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
