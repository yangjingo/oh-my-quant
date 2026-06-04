import React, { useState, useMemo } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import { loadSettings, saveSettings } from "../storage/index.ts";
import { readLocalPortfolioSchemes } from "../tui/local-state.ts";
import { GOLD, GOLD_HIGHLIGHT } from "../tui/tokens.ts";

interface ConfigPanelProps {
  onDone: () => void;
  onAction?: (command: string) => void;
}

interface Field {
  key: string;
  label: string;
  get: () => string;
  set?: (v: string) => void;
  isSecret?: boolean;
  options?: string[];
  action?: string;
  editAction?: string;
  section?: string;
}

const MODEL_OPTIONS = ["sonnet", "opus", "haiku", "gpt-5.5"];
const THINKING_OPTIONS = ["off", "minimal", "low", "medium", "high", "xhigh"];

export function ConfigPanel({ onDone, onAction }: ConfigPanelProps) {
  const cfg = useMemo(() => loadSettings(), []);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [, forceUpdate] = useState(0);

  const fieldGroups = useMemo<Array<{ label: string; fields: Field[] }>>(() => {
    const schemes = readLocalPortfolioSchemes().filter((s) => s.available);

    return [
      {
        label: "Settings",
        fields: [
          {
            key: "ANTHROPIC_AUTH_TOKEN", label: "Auth token",
            get: () => cfg.env.WHYJ_AUTH_TOKEN ? "configured" : "not set",
            set: (v: string) => { cfg.env.WHYJ_AUTH_TOKEN = v; process.env.WHYJ_AUTH_TOKEN = v; },
            isSecret: true,
          },
          {
            key: "TUSHARE_TOKEN", label: "Tushare token",
            get: () => cfg.env.TUSHARE_TOKEN ? "configured" : "not set",
            set: (v: string) => { cfg.env.TUSHARE_TOKEN = v; process.env.TUSHARE_TOKEN = v; },
            isSecret: true,
          },
          {
            key: "model", label: "Model",
            get: () => cfg.model,
            set: (v: string) => { cfg.model = v; },
            options: MODEL_OPTIONS,
          },
          {
            key: "thinking", label: "Thinking",
            get: () => cfg.thinkingLevel,
            set: (v: string) => { cfg.thinkingLevel = v; },
            options: THINKING_OPTIONS,
          },
        ],
      },
      {
        label: "Portfolio",
        fields: [
          {
            key: "portfolioVariant", label: "Scheme",
            get: () => {
              const active = schemes.find((s) => s.variant === cfg.preferences.portfolioVariant);
              return active?.name || cfg.preferences.portfolioVariant;
            },
            set: (v: string) => {
              const target = schemes.find((s) => s.name === v || s.variant === v);
              if (target) cfg.preferences.portfolioVariant = target.variant;
            },
            options: schemes.map((s) => s.name),
          },
        ],
      },
      {
        label: "MCP Servers",
        fields: Object.entries(cfg.mcp?.servers || {}).map(([name, srv]: [string, any]) => ({
          key: `mcp_${name}`, label: name,
          get: () => srv.enabled ? "on" : "off",
          set: (v: string) => { srv.enabled = v === "on"; },
          options: ["off", "on"],
        })),
      },
      {
        label: "Data",
        fields: [
          {
            key: "fetch", label: "Fetch bars",
            get: () => "enter symbol…",
            action: "/skill", editAction: "/skill trigger fetch_bars --code ",
          },
          {
            key: "claw", label: "Snapshot",
            get: () => "enter symbol…",
            action: "/skill", editAction: "/claw --code ",
          },
        ],
      },
      {
        label: "Tools",
        fields: [
          {
            key: "skills", label: "Skills",
            get: () => "list all",
            action: "/skill",
          },
          {
            key: "benchmark", label: "Benchmarks",
            get: () => "view dashboard",
            action: "/benchmark",
          },
          {
            key: "mcp_status", label: "MCP status",
            get: () => "server list",
            action: "/mcp",
          },
          {
            key: "mcp_connect", label: "MCP connect",
            get: () => "connect all",
            action: "/mcp connect",
          },
        ],
      },
      {
        label: "Watchlist",
        fields: [
          {
            key: "watch", label: "Watch fund",
            get: () => "enter code",
            action: "/skill", editAction: "/watch ",
          },
          {
            key: "watchlist", label: "Show list",
            get: () => "view all",
            action: "/watch",
          },
        ],
      },
      {
        label: "Session",
        fields: [
          {
            key: "help", label: "Help",
            get: () => "commands list",
            action: "/help",
          },
          {
            key: "clear", label: "Clear chat",
            get: () => "reset history",
            action: "/clear",
          },
        ],
      },
    ];
  }, [cfg]);

  const fields: Field[] = fieldGroups.flatMap((g) => g.fields);

  function cycle(f: Field, direction: 1 | -1 = 1) {
    if (!f.options) return;
    const idx = f.options.indexOf(f.get());
    const next = (idx + direction + f.options.length) % f.options.length;
    f.set?.(f.options[next]);
    saveSettings(cfg);
    forceUpdate((n) => n + 1);
  }

  function executeAction(f: Field) {
    if (!f.action) return;
    if (f.editAction) {
      setEditing(true);
      setEditValue("");
      return;
    }
    if (onAction) {
      onAction(f.action);
      onDone();
    }
  }

  useInput((input, key) => {
    if (editing) {
      if (key.return) {
        const f = fields[cursor];
        if (f?.editAction && editValue.trim()) {
          const cmd = f.editAction + editValue.trim();
          setEditing(false);
          setEditValue("");
          if (onAction) {
            onAction(cmd);
            setStatusMsg(`Running: ${cmd}`);
          }
          return;
        }
        if (f?.set && f?.isSecret && editValue.trim()) {
          f.set(editValue.trim());
          saveSettings(cfg);
        }
        setEditing(false);
        setEditValue("");
        return;
      }
      if (key.escape) { setEditing(false); setEditValue(""); return; }
      if (key.backspace || key.delete) { setEditValue((v) => v.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setEditValue((v) => v + input); }
      return;
    }

    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : fields.length - 1));
    } else if (key.downArrow) {
      setCursor((c) => (c < fields.length - 1 ? c + 1 : 0));
    } else if (key.leftArrow) {
      const f = fields[cursor];
      if (f?.options && !f.action) {
        cycle(f, -1);
      }
    } else if (key.rightArrow) {
      const f = fields[cursor];
      if (f?.options && !f.action) {
        cycle(f, 1);
      }
    } else if (key.return) {
      const f = fields[cursor];
      if (!f) return;
      if (f.action) {
        executeAction(f);
      } else if (f.options) {
        cycle(f);
      } else if (f.isSecret) {
        setEditing(true);
        setEditValue("");
      }
    } else if (key.escape) {
      onDone();
    }
  });

  const status = (f: Field) => {
    if (f.isSecret) return f.get() !== "not set" ? "configured" : "not set";
    return f.get();
  };

  const statusColor = (f: Field) => {
    if (f.isSecret) return f.get() !== "not set" ? GOLD : undefined;
    return undefined;
  };

  const currentIdx = (f: Field) => {
    if (!f.options) return null;
    const idx = f.options.indexOf(f.get());
    return idx >= 0 ? `${idx + 1}/${f.options.length}` : null;
  };

  // Build sectioned render
  const rows: { field: Field; idx: number; isSection: boolean; sectionLabel?: string }[] = [];
  let globalIdx = 0;
  for (const group of fieldGroups) {
    rows.push({ field: { key: `sec-${group.label}`, label: "", get: () => "" }, idx: -1, isSection: true, sectionLabel: group.label });
    for (const f of group.fields) {
      rows.push({ field: f, idx: globalIdx++, isSection: false });
    }
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={GOLD}>WhyJ Quant</Text>
        <Text dimColor>  ↑↓ select  ← → cycle  ↵ act  esc back</Text>
      </Box>

      {rows.map((row, i) => {
        if (row.isSection) {
          return (
            <Box key={`sec-${i}`} marginTop={i > 0 ? 1 : 0} marginBottom={0}>
              <Text dimColor bold>── {row.sectionLabel} ──</Text>
            </Box>
          );
        }

        const f = row.field;
        const active = row.idx === cursor;
        const val = status(f);
        const color = statusColor(f);
        const isAction = !!f.action;
        const pos = currentIdx(f);

        return (
          <Box key={f.key}>
            <Text color={active ? GOLD : undefined}>
              {active ? "> " : "  "}{f.label}
            </Text>
            <Text dimColor>  </Text>
            {editing && active ? (
              <Text color={GOLD_HIGHLIGHT}>[{editValue}|]</Text>
            ) : (
              <Text color={color} dimColor={isAction}>[{isAction ? "▶" : ""}{val}]</Text>
            )}
            {pos && active && !editing ? (
              <Text dimColor>  {pos}</Text>
            ) : null}
            {f.options && active && !editing ? (
              <Text dimColor>  ← →</Text>
            ) : null}
            {isAction && active && !editing ? (
              <Text dimColor>  ↵ run</Text>
            ) : null}
          </Box>
        );
      })}

      {editing && (
        <Box marginTop={1}>
          <Text dimColor>{fields[cursor].label}: </Text>
          <Text color={GOLD_HIGHLIGHT}>{editValue}|</Text>
        </Box>
      )}
      {statusMsg ? (
        <Box marginTop={1}><Text dimColor>{statusMsg}</Text></Box>
      ) : null}
    </Box>
  );
}
