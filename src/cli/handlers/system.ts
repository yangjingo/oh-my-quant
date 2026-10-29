import { buildCommandHelpText } from "../catalog.ts";
import { buildDoctorErrorResult, collectDoctor, formatDoctorText } from "../doctor.ts";
import type { CommandHandler, CommandResult } from "../types.ts";
import type { CompactResult } from "../../agent/src/session-runtime/index.ts";
import { hasWhyjEnvValue, loadPanelPortfolio, loadSettings, resolveSettingsPath } from "../../storage/index.ts";
import { describeModelProtocol } from "../../runtime/workspace/doctor-contract.ts";
import { resolveConfiguredModel, resolveConfiguredAuth, configuredThinking } from "../../agent/src/model-config.ts";
import { DEFAULT_SETTINGS } from "../../types/config.ts";
import { toolProbeDoctor } from "./tool-probe.ts";
import { researchTaskLines } from "../../runtime/workspace/research-task-view.ts";
import { extensionsHandler } from "./extensions.ts";
import { piConfigHandler } from "./pi-config.ts";
import { parseDoctorPhases } from "../../runtime/workspace/doctor-phases.ts";

function mark(ok: boolean): string {
  return ok ? "✓" : "○";
}

type SummarySections = Record<string, string[]>;
type CompactContextRow = { label: string; value: string };

function cleanSummaryLine(line: string): string {
  return line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim();
}

function parseSummarySections(summary: string): SummarySections {
  const sections: SummarySections = {};
  let current = "";
  for (const rawLine of summary.split(/\r?\n/)) {
    const line = rawLine.trim();
    const top = /^##\s+(.+)$/.exec(line);
    if (top) {
      current = top[1].trim();
      if (!sections[current]) sections[current] = [];
      continue;
    }
    if (/^###\s+/.test(line) || !line || !current) continue;
    const cleaned = cleanSummaryLine(line);
    if (!cleaned || /^\[.*\]$/.test(cleaned) || cleaned === "(none)") continue;
    sections[current].push(cleaned);
  }
  return sections;
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  return result;
}

function pickCategory(lines: string[], pattern: RegExp, limit = 2): string[] {
  return dedupeLines(lines.filter((line) => pattern.test(line))).slice(0, limit);
}

function compactLine(text: string, max = 110): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, Math.max(0, max - 3))}...`;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${value}`;
}

function padRight(value: string, width: number): string {
  return value.padEnd(width, " ");
}

function buildAlignedTable(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((header, idx) => Math.max(
    header.length,
    ...rows.map((row) => row[idx]?.length ?? 0),
  ));
  const header = headers.map((cell, idx) => padRight(cell, widths[idx])).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rows.map((row) => row.map((cell, idx) => padRight(cell, widths[idx])).join("  "));
  return [header, divider, ...body];
}

function buildMeter(filled: number, total = 8): string {
  const safeFilled = Math.max(0, Math.min(total, filled));
  return `${"█".repeat(safeFilled)}${"░".repeat(total - safeFilled)}`;
}

function buildCompactFigure(rows: CompactContextRow[]): string[] {
  const labelWidth = Math.max(...rows.map((row) => row.label.length), "retained".length);
  const keptCount = rows.filter((row) => row.value).length;
  const lines = [
    `${padRight("retained", labelWidth)}  ${buildMeter(Math.round(rows.length === 0 ? 0 : keptCount / rows.length * 8))}  ${keptCount}/${rows.length}`,
  ];
  for (const row of rows) {
    const kept = !!row.value;
    lines.push(`${padRight(row.label, labelWidth)}  ${buildMeter(kept ? 8 : 0)}  ${kept ? "kept" : "missing"}`);
  }
  return lines;
}

function buildCompactReceipt(result: CompactResult, customInstructions?: string): string {
  const sections = parseSummarySections(result.summary);
  const scopeLines = [
    ...(sections["Critical Context"] ?? []),
    ...(sections["Goal"] ?? []),
    ...(sections["Constraints & Preferences"] ?? []),
    ...(sections["Next Steps"] ?? []),
  ];
  const dateLines = [
    ...(sections["Critical Context"] ?? []),
    ...(sections["Next Steps"] ?? []),
    ...(sections["Goal"] ?? []),
  ];
  const paramLines = [
    ...(sections["Key Decisions"] ?? []),
    ...(sections["Critical Context"] ?? []),
    ...(sections["Constraints & Preferences"] ?? []),
    ...(sections["Next Steps"] ?? []),
  ];
  const findingLines = [
    ...(sections["Next Steps"] ?? []),
    ...(sections["Critical Context"] ?? []),
    ...(sections["Progress"] ?? []),
    ...(sections["Goal"] ?? []),
  ];
  const scope = pickCategory(
    scopeLines,
    /(symbol|ticker|benchmark|portfolio|holding|universe|allocation|exposure|标的|基准|组合|持仓|股票池|指数|etf|a-share|沪深|中证|创业板|科创)/i,
  );
  const dates = pickCategory(
    dateLines,
    /(date|range|lookback|window|rebalance|cadence|timeframe|start|end|daily|weekly|monthly|区间|日期|回看|窗口|调仓|频率|日线|周线|月线)/i,
  );
  const paramsRisk = pickCategory(
    paramLines,
    /(factor|signal|strategy|parameter|threshold|risk|drawdown|var|cvar|sharpe|cagr|stop|limit|slippage|因子|信号|策略|参数|风险|回撤|夏普|止损|仓位)/i,
  );
  const findings = pickCategory(
    findingLines,
    /(validated|conclusion|hypothesis|finding|open|pending|next|follow-up|test|validate|investigate|结论|假设|待验证|观察|下一步|测试|验证|排查)/i,
  );
  const quantRows: CompactContextRow[] = [
    { label: "scope", value: scope.join(" | ") },
    { label: "dates/window", value: dates.join(" | ") },
    { label: "params/risk", value: paramsRisk.join(" | ") },
    { label: "open threads", value: findings.join(" | ") },
  ];
  const keptCount = quantRows.filter((row) => row.value).length;
  const metricsRows = [
    ["first kept", result.firstKeptEntryId, "session tree cut point"],
    ["tokens before", formatCount(result.tokensBefore), "pre-compaction context"],
    ["retained fields", `${keptCount}/${quantRows.length}`, "quant summary coverage"],
  ];
  if (customInstructions) metricsRows.push(["focus", compactLine(customInstructions, 48), "custom compact hint"]);
  const lines = ["Compacted", "", ...buildAlignedTable(["metric", "value", "note"], metricsRows)];
  const hasQuantContext = keptCount > 0;
  if (hasQuantContext) {
    lines.push("", "quant context kept", "");
    lines.push(...buildAlignedTable(
      ["field", "status", "detail"],
      quantRows
        .filter((row) => row.value)
        .map((row) => [row.label, "kept", compactLine(row.value, 72)]),
    ));
    lines.push("", "retention map", "");
    lines.push(...buildCompactFigure(quantRows));
  }
  lines.push("", result.summary);
  return lines.join("\n");
}

export const helpHandler: CommandHandler = async (_flags, _positional, ctx) => {
  if (ctx.openHelp) {
    return { success: true, message: "", effects: [{ type: "openHelp" }] };
  }
  return { success: true, message: buildCommandHelpText() };
};

export const clearHandler: CommandHandler = async () => ({
  success: true,
  message: "",
  renderAs: "text",
  effects: [{ type: "clearConversation" }, { type: "resetAgent" }],
});

export const compactHandler: CommandHandler = async (_flags, positional, ctx) => {
  const agent = ctx.agentSession;
  if (!agent) {
    return { success: false, message: "This command needs an active agent session. Send any AI message first, then try /compact again." };
  }
  const customInstructions = positional.join(" ").trim() || undefined;
  let result: Awaited<ReturnType<typeof agent.compact>>;
  try {
    await agent.waitForIdle();
    result = await agent.compact(customInstructions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Nothing to compact")) {
      return {
        success: true,
        message: "Nothing to compact. The current session context is already small enough.",
      };
    }
    if (message.includes("requires idle harness") || message.includes("AgentHarness is busy")) {
      return {
        success: false,
        message: "The current turn is still finishing. Run /compact again after the reply or tool output settles.",
      };
    }
    throw error;
  }
  return {
    success: true,
    message: buildCompactReceipt(result, customInstructions),
    effects: [{ type: "compactSession" }, { type: "sessionChanged" }],
  };
};

export const configHandler: CommandHandler = async (_flags, _positional, ctx) => {
  if (_flags.pi !== undefined) return piConfigHandler(_flags, _positional, ctx);
  if (_flags.extensions !== undefined) return extensionsHandler(_flags, _positional, ctx);
  if (ctx.openConfig) {
    return { success: true, message: "", effects: [{ type: "openConfig" }] };
  }
  const cfg = loadSettings();
  const panelPortfolio = loadPanelPortfolio();
  const activeName = panelPortfolio.groups.length === 1 && panelPortfolio.groups[0]?.name
    ? panelPortfolio.groups[0].name
    : panelPortfolio.groups.length ? `${panelPortfolio.groups.length} portfolios` : "No portfolios";
  let modelSummary: string;
  let providerSummary: string;
  try {
    const model = resolveConfiguredModel(cfg);
    const auth = await resolveConfiguredAuth(cfg, model);
    modelSummary = `${model.id}  ·  thinking ${configuredThinking(cfg)}`;
    providerSummary = `${model.provider}  ·  credentials ${mark(Boolean(auth))}  ·  ${model.baseUrl || "SDK default endpoint"}  ·  ${describeModelProtocol(model.api)}`;
  } catch (error) {
    modelSummary = cfg.model;
    providerSummary = error instanceof Error ? error.message : "Check model configuration";
  }
  return {
    success: true,
    message: [
      "Settings",
      `  Agent       ${modelSummary}`,
      `  Provider    ${providerSummary}`,
      `  Research    ${cfg.preferences.source}  ·  portfolio ${activeName}`,
      `  Data keys   ${mark(hasWhyjEnvValue(cfg.env, "tushareToken"))} Tushare  ${mark(hasWhyjEnvValue(cfg.env, "financialDatasetsKey"))} Financial Datasets  ${mark(hasWhyjEnvValue(cfg.env, "llmquantApiKey"))} LLMQuant`,
      `  Workspace   external skills ${cfg.skillIntegrations.external ? "on" : "off"}  ·  overview ${cfg.showPortfolioPanel ? "on" : "off"}  ·  auto artifacts ${cfg.artifactGeneration.auto ? "on" : "off"}`,
      `  Path        ${resolveSettingsPath()}`,
      "  Open /config or press Ctrl+P to change these settings.",
      "  Manage plugins with /config --extensions list.",
      "  Inspect Pi connections with /config --pi list.",
    ].join("\n"),
  };
};

export function createDoctorHandler(collect: typeof collectDoctor = collectDoctor): CommandHandler {
  return (...args) => runDoctorHandler(...args, collect);
}

export const doctorHandler: CommandHandler = createDoctorHandler();

async function runDoctorHandler(
  _flags: Parameters<CommandHandler>[0],
  _positional: Parameters<CommandHandler>[1],
  ctx: Parameters<CommandHandler>[2],
  collect: typeof collectDoctor,
): Promise<CommandResult> {
  const cancelled = { success: true, message: "" };
  if (ctx.doctorSignal?.aborted) return cancelled;
  const requestedPhases = parseDoctorPhases(_flags.phase);
  let settings = DEFAULT_SETTINGS;
  try {
    settings = loadSettings();
  } catch {
    settings = DEFAULT_SETTINGS;
  }
  if (_flags.tool !== undefined) {
    if (_positional.length) return { success: false, message: "Endpoint arguments must use --name value. Use the parameter editor for values containing spaces." };
    return toolProbeDoctor(settings, _flags, ctx.doctorSignal);
  }
  if (ctx.openDoctor) {
    ctx.openDoctor();
    try {
      const doctor = await collect(settings, process.env, {
        signal: ctx.doctorSignal,
        phases: requestedPhases,
        seedState: ctx.currentDoctor ?? undefined,
        onState: (state) => { if (!ctx.doctorSignal?.aborted) ctx.openDoctor?.(state); },
      });
      if (ctx.doctorSignal?.aborted) return cancelled;
      ctx.openDoctor(doctor);
      return { success: true, message: "", data: doctor };
    } catch (error) {
      if (ctx.doctorSignal?.aborted) return cancelled;
      const doctor = buildDoctorErrorResult(settings, process.env, error, requestedPhases);
      ctx.openDoctor(doctor);
      return {
        success: false,
        message: `Doctor failed: ${doctor.phases.find((phase) => phase.status === "fail")?.error || "unknown error"}`,
        data: doctor,
      };
    }
  }
  try {
    const doctor = await collect(settings, process.env, { phases: requestedPhases, signal: ctx.doctorSignal });
    if (ctx.doctorSignal?.aborted) return cancelled;
    return {
      success: true,
      message: formatDoctorText(doctor),
      data: doctor,
      renderAs: "text",
    };
  } catch (error) {
    if (ctx.doctorSignal?.aborted) return cancelled;
    const doctor = buildDoctorErrorResult(settings, process.env, error, requestedPhases);
    return {
      success: false,
      message: formatDoctorText(doctor),
      data: doctor,
      renderAs: "text",
    };
  }
}

export { portfolioHandler } from "./portfolio.ts";

export const resumeHandler: CommandHandler = async (_flags, positional, ctx) => {
  const agent = ctx.sessionCommands ?? ctx.agentSession;
  if (_flags.task !== undefined) {
    if (_flags.task !== true || positional.length || Object.keys(_flags).length !== 1) return { success: false, message: "Use /resume --task by itself to inspect the active research task." };
    if (!agent?.getResearchState) return { success: false, message: "Task inspection needs an active Quant session. Start whyj, then use /resume --task." };
    const state = await agent.getResearchState();
    const snapshot = { leafId: state.leafId, task: state.task, taskErrors: state.taskErrors, unresolved: state.unresolved };
    if (ctx.openResearch) { ctx.openResearch(snapshot); return { success: true, message: "", data: snapshot }; }
    return { success: true, message: researchTaskLines(snapshot).join("\n"), data: snapshot, renderAs: "text" };
  }
  const action = positional[0]?.trim();
  if (!action) {
    if (ctx.openResume) {
      return { success: true, message: "", effects: [{ type: "openResume" }] };
    }
  }

  if (!agent) {
    return { success: false, message: "This command needs an active agent session. Send any AI message first, then try /resume again." };
  }

  if (!action) {
    const sessions = await agent.listSessions();
    const current = await agent.getSessionMetadata();
    const lines = sessions.slice(0, 10).map((session, index) => {
      const active = current?.id === session.id ? "*" : " ";
      return `${active}${index + 1}. ${session.id}  ${session.createdAt}  ${session.path}`;
    });
    return {
      success: true,
      message: lines.length > 0
        ? ["Saved sessions", ...lines, "Use /resume <sessionId> to switch sessions"].join("\n")
        : "No saved sessions yet. Start a conversation first, then come back to /resume.",
    };
  }

  const metadata = await agent.resumeSession(action);
  return {
    success: true,
    message: [
      "Resumed",
      `id: ${metadata.id}`,
      `created: ${metadata.createdAt}`,
      `cwd: ${metadata.cwd}`,
      `file: ${metadata.path}`,
    ].join("\n"),
    effects: [{ type: "sessionChanged" }],
  };
};

export const sessionHandler: CommandHandler = async (_flags, _positional, ctx) => {
  if (ctx.openSession) {
    return { success: true, message: "", effects: [{ type: "openSession" }] };
  }
  const agent = ctx.agentSession;
  if (!agent) {
    return { success: false, message: "This command needs an active agent session. Send any AI message first, then try /session again." };
  }
  const [metadata, usage] = await Promise.all([
    agent.getSessionMetadata(),
    Promise.resolve(agent.getContextUsage()),
  ]);
  if (!metadata) {
    return { success: false, message: "Current session metadata is unavailable. Start a conversation first, then retry." };
  }
  return {
    success: true,
    message: [
      "Session",
      `  id          ${metadata.id}`,
      `  created     ${metadata.createdAt}`,
      `  cwd         ${metadata.cwd}`,
      `  file        ${metadata.path}`,
      usage
        ? `  context     ${usage.tokens}/${usage.contextWindow} tokens${usage.percent !== null ? `  (${usage.percent.toFixed(1)}%)` : ""}`
        : "  context     unavailable",
    ].join("\n"),
  };
};
export const exitHandler = (): CommandResult => ({ success: true, message: "Goodbye." });
