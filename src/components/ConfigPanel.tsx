import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import { loadSettings, saveSettings } from "../storage/index.ts";

interface ConfigPanelProps {
  onDone: () => void;
}

interface Field {
  key: string;
  label: string;
  alias: string;
  get: () => string;
  set: (v: string) => void;
}

export function ConfigPanel({ onDone }: ConfigPanelProps) {
  const cfg = loadSettings();
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const fields: Field[] = [
    {
      key: "ANTHROPIC_API_KEY", label: "Anthropic API key",
      alias: "anthropic",
      get: () => (cfg.apiKeys.ANTHROPIC_API_KEY ? "configured" : "not set"),
      set: (v) => { cfg.apiKeys.ANTHROPIC_API_KEY = v; process.env.ANTHROPIC_API_KEY = v; },
    },
    {
      key: "TUSHARE_TOKEN", label: "Tushare token",
      alias: "tushare",
      get: () => (cfg.apiKeys.TUSHARE_TOKEN ? "configured" : "not set"),
      set: (v) => { cfg.apiKeys.TUSHARE_TOKEN = v; process.env.TUSHARE_TOKEN = v; },
    },
    {
      key: "FINANCIAL_DATASETS_KEY", label: "Financial Datasets key",
      alias: "financial",
      get: () => (cfg.apiKeys.FINANCIAL_DATASETS_KEY ? "configured" : "not set"),
      set: (v) => { cfg.apiKeys.FINANCIAL_DATASETS_KEY = v; process.env.FINANCIAL_DATASETS_KEY = v; },
    },
    {
      key: "LLMQUANT_API_KEY", label: "LLMQuant key",
      alias: "llmquant",
      get: () => (cfg.apiKeys.LLMQUANT_API_KEY ? "configured" : "not set"),
      set: (v) => { cfg.apiKeys.LLMQUANT_API_KEY = v; process.env.LLMQUANT_API_KEY = v; },
    },
    {
      key: "model", label: "Model",
      alias: "model",
      get: () => cfg.anthropic.model,
      set: (v) => { cfg.anthropic.model = v; },
    },
    {
      key: "thinking", label: "Thinking depth",
      alias: "thinking",
      get: () => cfg.anthropic.thinkingLevel,
      set: (v) => { cfg.anthropic.thinkingLevel = v as typeof cfg.anthropic.thinkingLevel; },
    },
  ];

  const handleSelect = useCallback(() => {
    const field = fields[cursor];
    if (!field) return;
    if (field.key.startsWith("ANTHROPIC") || field.key.endsWith("TOKEN") || field.key.endsWith("KEY")) {
      setEditing(true);
      setEditValue("");
    } else {
      // model / thinking: cycle values
      if (field.key === "model") {
        const models = ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"];
        const idx = models.indexOf(field.get());
        field.set(models[(idx + 1) % models.length]);
      } else if (field.key === "thinking") {
        const levels = ["off", "minimal", "low", "medium", "high"];
        const idx = levels.indexOf(field.get());
        field.set(levels[(idx + 1) % levels.length]);
      }
      saveSettings(cfg);
    }
  }, [cursor, editing, editValue]);

  useInput((input, key) => {
    if (editing) {
      if (key.return) {
        const field = fields[cursor];
        if (field && editValue.trim()) {
          field.set(editValue.trim());
          saveSettings(cfg);
        }
        setEditing(false);
        setEditValue("");
      } else if (key.escape) {
        setEditing(false);
        setEditValue("");
      } else if (key.backspace || key.delete) {
        setEditValue((v) => v.slice(0, -1));
      } else if (input.length > 0 && !key.ctrl) {
        setEditValue((v) => v + input);
      }
      return;
    }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(fields.length - 1, c + 1));
    } else if (key.return) {
      handleSelect();
    } else if (key.escape || input === "/") {
      onDone();
    }
  });

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>WhyJ Quant Setup</Text>
        <Text dimColor>  ↑↓ select  ↵ toggle/edit  esc back</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {fields.map((f, i) => {
          const isCursor = i === cursor;
          const val = f.get();
          const isKey = f.key.endsWith("_KEY") || f.key.endsWith("TOKEN") || f.key.startsWith("ANTHROPIC");
          const icon = isKey ? (val !== "not set" ? "✓" : "✗") : "";

          return (
            <Box key={f.key} marginBottom={1}>
              {isCursor ? (
                <Text color="cyan" bold>❯ </Text>
              ) : (
                <Text>  </Text>
              )}
              <Text color={isCursor ? "cyan" : undefined}>
                {f.label}
              </Text>
              <Text dimColor>  </Text>
              <Text color={icon === "✓" ? "green" : icon === "✗" ? "red" : undefined}>
                {editing && isCursor
                  ? `[${editValue || "type value..._"}█]`
                  : `[${icon} ${val}]`
                }
              </Text>
            </Box>
          );
        })}
      </Box>

      {editing && (
        <Box marginBottom={1}>
          <Text dimColor>{fields[cursor].label}: </Text>
          <Text>{editValue}</Text>
          <Text color="cyan">█</Text>
        </Box>
      )}

      <Text dimColor>
        {editing ? "Enter value then ↵. esc to cancel." : "↵ on model/thinking cycles values. esc exits."}
      </Text>
    </Box>
  );
}
