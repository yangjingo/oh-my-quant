import React, { useState, useMemo } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GOLD } from "../tui/tokens.ts";

interface InputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

interface SubCmd {
  name: string; desc: string; usage: string;
}

interface CmdDef {
  name: string; desc: string; subs?: SubCmd[];
}

const CMDS: CmdDef[] = [
  { name: "/claw", desc: "Stock snapshot", subs: [] },
  { name: "/skill", desc: "List or trigger skills", subs: [
    { name: "list", desc: "List available skills", usage: "/skill list" },
    { name: "info", desc: "Show skill details", usage: "/skill info --name NAME" },
    { name: "trigger", desc: "Execute skill directly", usage: "/skill trigger --name NAME --code CODE" },
  ]},
  { name: "/add", desc: "Manage watchlist", subs: [
    { name: "stock", desc: "Add stock to watchlist", usage: "/add stock --code CODE --name NAME" },
    { name: "list", desc: "Show watchlist", usage: "/add list" },
    { name: "remove", desc: "Remove from watchlist", usage: "/add remove --code CODE" },
  ]},
  { name: "/portfolio", desc: "Configure portfolio panel", subs: [
    { name: "source", desc: "Switch data source", usage: "/portfolio source --name NAME" },
    { name: "add", desc: "Add to panel display", usage: "/portfolio add --code CODE" },
    { name: "remove", desc: "Remove from display", usage: "/portfolio remove --code CODE" },
  ]},
  { name: "/config", desc: "Interactive settings", subs: [] },
  { name: "/benchmark", desc: "Strategy scoring dashboard", subs: [
    { name: "dashboard", desc: "Full results ranking", usage: "/benchmark dashboard" },
  ]},
  { name: "/mcp", desc: "Connect to data servers", subs: [
    { name: "connect", desc: "Connect to all servers", usage: "/mcp connect" },
    { name: "status", desc: "Show connection status", usage: "/mcp status" },
  ]},
  { name: "/help", desc: "Show all commands", subs: [] },
  { name: "/clear", desc: "Clear conversation", subs: [] },
  { name: "/exit", desc: "Exit WhyJ Quant", subs: [] },
];

interface CodeEntry { code: string; name: string; }

function getWatchlist(): CodeEntry[] {
  try {
    const path = join(process.cwd(), ".ohquant", "watchlist.json");
    if (!existsSync(path)) return [];
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return raw.stocks || [];
  } catch { return []; }
}

interface Suggestion { label: string; fill: string; }

export function Input({ onSubmit, disabled }: InputProps) {
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

    // Level 2: subcommand suggestions (e.g. "/portfolio " → source/add/remove)
    const spaceIdx = value.indexOf(" ");
    if (spaceIdx > 0) {
      const cmdName = value.slice(0, spaceIdx).toLowerCase();
      const partial = value.slice(spaceIdx + 1).toLowerCase();
      const cmd = CMDS.find((c) => c.name.toLowerCase() === cmdName);
      if (cmd?.subs?.length) {
        return cmd.subs
          .filter((s) => !partial || s.name.startsWith(partial))
          .map((s) => ({ label: `${s.name}  ${s.desc}`, fill: s.usage }));
      }
      return [];
    }

    // Level 1: command suggestions (e.g. "/por" → /portfolio)
    const lower = value.toLowerCase();
    return CMDS
      .filter((c) => c.name.toLowerCase().startsWith(lower))
      .map((c) => ({ label: `${c.name}  ${c.desc}`, fill: c.subs?.length ? `${c.name} ` : c.name }));
  }, [value, watchlist]);

  const hasSuggestions = suggestions.length > 0;

  useInput((input, key) => {
    if (disabled) return;

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
        const chosen = suggestions[cursor % suggestions.length];
        setHistory((h) => [chosen.fill, ...h].slice(0, 100));
        onSubmit(chosen.fill);
        setValue("");
        setCursor(0);
        return;
      }
      if (key.tab) {
        setValue(suggestions[cursor % suggestions.length].fill);
        setCursor(0);
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
    <Box flexDirection="column">
      {hasSuggestions && (
        <Box flexDirection="column" marginBottom={1}>
          {suggestions.map((s, i) => (
            <Box key={s.label}>
              <Text color={i === cursor ? GOLD : undefined}>
                {i === cursor ? "> " : "  "}
              </Text>
              <Text bold color={i === cursor ? GOLD : undefined}>
                {s.label}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      <Box>
        <Text color={GOLD} bold>{"> "}</Text>
        {value ? (
          <Text>{value}</Text>
        ) : (
          <Text dimColor>ask a research question or type /</Text>
        )}
        <Text dimColor>|</Text>
      </Box>
    </Box>
  );
}
