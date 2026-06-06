import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { Spinner } from "./Spinner.tsx";
import { ElapsedTimer } from "./AnimatedText.tsx";
import { GOLD } from "../tui/tokens.ts";

export interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: string;
  error?: string;
  partial?: string;
}

export function ToolCall({ call }: { call: ToolCallState }) {
  return (
    <ToolCallInline
      name={call.name}
      args={call.args}
      status={call.status}
      result={call.result}
      error={call.error}
      partial={call.partial}
    />
  );
}

interface ToolCallInlineProps {
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: string;
  error?: string;
  partial?: string;
}

export function ToolCallInline({ name, args, status, result, error, partial }: ToolCallInlineProps) {
  const [collapsed, setCollapsed] = useState(true);
  const prevStatus = useRef(status);
  const startMs = useRef(Date.now());

  useEffect(() => {
    if (status !== "running" && prevStatus.current === "running") setCollapsed(true);
    prevStatus.current = status;
  }, [status]);

  const label = formatToolLabel(name);
  const isRunning = status === "running";

  const preview = (() => {
    if (args.path || args.file || args.filename) return String(args.path || args.file || args.filename);
    if (args.symbol || args.code) return String(args.symbol || args.code);
    if (args.factor) return `${args.factor}${args.period ? `, p=${args.period}` : ""}`;
    if (args.fast && args.slow) return `SMA(${args.fast},${args.slow})`;
    if (args.variant) return `variant=${args.variant}`;
    if (args.ticker) return String(args.ticker);
    if (args.keyword) return String(args.keyword);
    return "";
  })();

  const displayText = partial || result || error;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        {isRunning ? (
          <Spinner active={true} variant="dots" color={GOLD} />
        ) : status === "error" ? (
          <Text color={GOLD}>✗</Text>
        ) : (
          <Text color={GOLD}>✓</Text>
        )}
        <Text color={isRunning ? GOLD : status === "error" ? undefined : undefined}>
          {" "}{label}
        </Text>
        {preview ? <Text dimColor>{" · "}{preview}</Text> : null}
        <ElapsedTimer active={isRunning} startMs={startMs.current} />
        {!isRunning && displayText ? (
          <Text dimColor> {collapsed ? "[+]" : "[-]"}</Text>
        ) : null}
      </Box>
      {!isRunning && !collapsed && displayText && (
        <Box marginLeft={2} marginTop={0}>
          <Text dimColor wrap="wrap">{displayText}</Text>
        </Box>
      )}
    </Box>
  );
}

function formatToolLabel(name: string): string {
  const normalized = name.toLowerCase().replace(/-/g, "_");
  if (normalized === "read" || normalized === "read_file" || normalized === "file_read") return "READ";
  if (
    normalized === "write"
    || normalized === "write_file"
    || normalized === "file_write"
    || normalized === "edit"
    || normalized === "apply_patch"
  ) return "WRITE";
  return name.replace(/_/g, " ");
}
