import React, { useState, useMemo } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import { loadSettings, saveSettings } from "../storage/index.ts";

interface ConfigPanelProps {
  onDone: () => void;
}

interface Field {
  key: string;
  label: string;
  get: () => string;
  set: (v: string) => void;
  isSecret: boolean;
  options?: string[];
}

export function ConfigPanel({ onDone }: ConfigPanelProps) {
  const cfg = useMemo(() => loadSettings(), []);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const fields: Field[] = useMemo(() => [
    {
      key: "ANTHROPIC_API_KEY", label: "Anthropic API key",
      get: () => cfg.apiKeys.ANTHROPIC_API_KEY ? "●●●●●●" : "not set",
      set: (v) => { cfg.apiKeys.ANTHROPIC_API_KEY = v; process.env.ANTHROPIC_API_KEY = v; },
      isSecret: true,
    },
    {
      key: "TUSHARE_TOKEN", label: "Tushare token",
      get: () => cfg.apiKeys.TUSHARE_TOKEN ? "●●●●●●" : "not set",
      set: (v) => { cfg.apiKeys.TUSHARE_TOKEN = v; process.env.TUSHARE_TOKEN = v; },
      isSecret: true,
    },
    {
      key: "FINANCIAL_DATASETS_KEY", label: "Financial key",
      get: () => cfg.apiKeys.FINANCIAL_DATASETS_KEY ? "●●●●●●" : "not set",
      set: (v) => { cfg.apiKeys.FINANCIAL_DATASETS_KEY = v; process.env.FINANCIAL_DATASETS_KEY = v; },
      isSecret: true,
    },
    {
      key: "LLMQUANT_API_KEY", label: "LLMQuant key",
      get: () => cfg.apiKeys.LLMQUANT_API_KEY ? "●●●●●●" : "not set",
      set: (v) => { cfg.apiKeys.LLMQUANT_API_KEY = v; process.env.LLMQUANT_API_KEY = v; },
      isSecret: true,
    },
    {
      key: "model", label: "Model",
      get: () => cfg.anthropic.model,
      set: (v) => { cfg.anthropic.model = v; },
      isSecret: false,
      options: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"],
    },
    {
      key: "thinking", label: "Thinking",
      get: () => cfg.anthropic.thinkingLevel,
      set: (v) => { cfg.anthropic.thinkingLevel = v as typeof cfg.anthropic.thinkingLevel; },
      isSecret: false,
      options: ["off", "minimal", "low", "medium", "high"],
    },
  ], [cfg]);

  function cycle(f: Field) {
    if (!f.options) return;
    const idx = f.options.indexOf(f.get());
    f.set(f.options[(idx + 1) % f.options.length]);
    saveSettings(cfg);
  }

  useInput((input, key) => {
    if (editing) {
      if (key.return) {
        const f = fields[cursor];
        if (f && editValue.trim()) {
          f.set(editValue.trim());
          saveSettings(cfg);
        }
        setEditing(false);
        setEditValue("");
      } else if (key.escape) {
        setEditing(false);
        setEditValue("");
      } else if (key.backspace || key.delete) {
        setEditValue((v) => v.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setEditValue((v) => v + input);
      }
      return;
    }

    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : fields.length - 1));
    } else if (key.downArrow) {
      setCursor((c) => (c < fields.length - 1 ? c + 1 : 0));
    } else if (key.return || key.tab) {
      const f = fields[cursor];
      if (f && f.options) {
        cycle(f);
      } else if (f && f.isSecret) {
        setEditing(true);
        setEditValue("");
      }
    } else if (key.escape) {
      onDone();
    }
  });

  const status = (f: Field) => {
    if (f.isSecret) return f.get() !== "not set" ? "✓" : "✗";
    return f.get();
  };

  const statusColor = (f: Field) => {
    if (f.isSecret) {
      return f.get() !== "not set" ? "green" : "red";
    }
    return undefined;
  };

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>WhyJ Setup</Text>
        <Text dimColor>  ↑↓  ↵ select/edit  esc back</Text>
      </Box>

      {fields.map((f, i) => {
        const active = i === cursor;
        const val = status(f);
        const color = statusColor(f);

        return (
          <Box key={f.key} marginBottom={1}>
            <Text color={active ? "cyan" : undefined}>
              {active ? "❯ " : "  "}{f.label}
            </Text>
            <Text dimColor>  </Text>
            {editing && active ? (
              <Text color="cyan">[{editValue || "_"}█]</Text>
            ) : (
              <Text color={color}>[{val}]</Text>
            )}
            {f.options && active && !editing ? (
              <Text dimColor>  ← →</Text>
            ) : null}
          </Box>
        );
      })}

      {editing && (
        <Box marginTop={1}>
          <Text dimColor>{fields[cursor].label}: </Text>
          <Text color="cyan">{editValue}█</Text>
        </Box>
      )}
    </Box>
  );
}
