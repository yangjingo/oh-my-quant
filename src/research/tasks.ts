import { createHash } from "node:crypto";
import { isDailyDate } from "../market/bars.ts";
import { validateObservationCutoff } from "../market/observation-cutoff.ts";
import { inferMarket, normalizeSymbol } from "../market/symbols.ts";
import { normalizeFundSymbol } from "../market/fund-nav.ts";
import { DEFAULT_BENCHMARK_SYMBOL } from "../quant/index.ts";
import { record } from "./references.ts";
import { recordedResearchTaskAction } from "./task-actions.ts";
import type { ResearchEntry, ResearchOperation } from "./state.ts";
import type { ResearchAttemptRef, ResearchTaskEvent, ResearchTaskSpec, ResearchTaskState } from "../types/research-task.ts";

/** Supported evidence verifiers, shared with the provider-facing task schema and capability discovery. */
export const RESEARCH_ACCEPTANCE_TOOLS: readonly string[] = ["compute_factor", "check_risk", "run_backtest", "analyze_archived_bars", "score_benchmark", "fund_dca_backtest", "show_dashboard", "compare_portfolios", "portfolio_comparisons", "alpha_backtest", "alpha_runs"];
const ARCHIVABLE_PRICE_TOOLS = ["compute_factor", "check_risk", "run_backtest"];
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = record(value);
  if (!object) throw new Error("Task parameters must be finite JSON values.");
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

export function validateResearchTask(value: unknown): ResearchTaskSpec {
  const task = record(value), scope = record(task?.scope), constraints = record(task?.constraints);
  if (!task || !text(task.id) || !text(task.request) || !text(task.goal) || !scope || !constraints
    || !strings(scope.symbols) || !scope.symbols.length || !["A", "HK", "US", "mixed"].includes(String(scope.market))
    || typeof scope.start !== "string" || !isDailyDate(scope.start) || typeof scope.end !== "string" || !isDailyDate(scope.end) || scope.start > scope.end
    || !strings(constraints.allowedTools) || !strings(constraints.notes) || !Array.isArray(task.criteria) || !task.criteria.length
    || !Array.isArray(task.dataRefs) || typeof task.reportRequired !== "boolean") throw new Error("Invalid research task declaration.");
  const symbols = scope.symbols;
  for (const symbol of symbols) if (normalizeSymbol(symbol) !== symbol || scope.market !== "mixed" && inferMarket(symbol) !== scope.market) throw new Error("Task symbol/market mismatch.");
  if (scope.benchmark !== undefined && (!text(scope.benchmark) || normalizeSymbol(scope.benchmark) !== scope.benchmark)) throw new Error("Invalid task benchmark.");
  if (scope.portfolioRevision !== undefined && !text(scope.portfolioRevision) || scope.groupIds !== undefined && (!strings(scope.groupIds) || !scope.groupIds.length)) throw new Error("Invalid task portfolio scope.");
  const ids = new Set<string>();
  for (const value of task.criteria) {
    const criterion = record(value);
    if (!criterion || !text(criterion.id) || ids.has(criterion.id) || !text(criterion.description) || !text(criterion.tool)
      || !RESEARCH_ACCEPTANCE_TOOLS.includes(criterion.tool) || !constraints.allowedTools.includes(criterion.tool) || !record(criterion.parameters) || !strings(criterion.metrics)) throw new Error("Invalid or duplicate task acceptance criterion.");
    if (criterion.tool === "analyze_archived_bars") {
      const parameters = record(criterion.parameters)!;
      if (!text(parameters.symbol) || !["A", "US", "HK"].includes(String(parameters.market))
        || !text(parameters.start) || !isDailyDate(parameters.start) || !text(parameters.end) || !isDailyDate(parameters.end)
        || parameters.start > parameters.end || !["factor", "backtest", "risk"].includes(String(parameters.analysis))
        || parameters.analysis === "factor" && !text(parameters.factor) || !text(parameters.observed_before))
        throw new Error("Archive acceptance requires symbol, market, price dates, mode and UTC observation cutoff.");
      validateObservationCutoff(parameters.observed_before);
    }
    if (ARCHIVABLE_PRICE_TOOLS.includes(criterion.tool)) {
      const parameters = record(criterion.parameters)!;
      if (parameters.observed_before !== undefined) {
        if (!text(parameters.symbol) || !["A", "US", "HK"].includes(String(parameters.market))
          || !text(parameters.start) || !isDailyDate(parameters.start) || !text(parameters.end)
          || !isDailyDate(parameters.end) || parameters.start > parameters.end
          || scope.market !== "mixed" && parameters.market !== scope.market)
          throw new Error("Historical price criterion requires symbol, matching market and explicit price dates.");
        validateObservationCutoff(parameters.observed_before as string);
      } else {
        if (parameters.source !== undefined) throw new Error("Historical source requires observed_before in a price criterion.");
        if (parameters.market !== undefined) {
          if (!["A", "US", "HK"].includes(String(parameters.market)) || !text(parameters.symbol)
            || normalizeSymbol(parameters.symbol, parameters.market as "A" | "US" | "HK") !== parameters.symbol
            || scope.market !== "mixed" && parameters.market !== scope.market)
            throw new Error("Current price criterion symbol/market mismatch.");
        }
      }
    }
    canonical(criterion.parameters); ids.add(criterion.id);
  }
  const refs = new Set<string>();
  for (const value of task.dataRefs) {
    const ref = record(value), key = `${ref?.kind}/${ref?.symbol}`;
    if (!ref || !["daily-bars", "fund-nav"].includes(String(ref.kind)) || !text(ref.symbol) || ![...symbols, scope.benchmark].includes(ref.symbol)
      || !text(ref.revision) || !text(ref.contentHash) || refs.has(key)) throw new Error("Invalid or conflicting task data reference.");
    refs.add(key);
  }
  canonical(task);
  return structuredClone(task) as unknown as ResearchTaskSpec;
}

function attemptMatches(operation: ResearchOperation, ref: ResearchAttemptRef): boolean {
  return operation.callEntryId === ref.callEntryId && operation.callId === ref.callId;
}

function differingParameters(operation: ResearchOperation, expected: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(expected), ...Object.keys(operation.parameters)])]
    .filter(key => !Object.hasOwn(expected, key) || !Object.hasOwn(operation.parameters, key)
      || canonical(operation.parameters[key]) !== canonical(expected[key]));
}

/** Enforced by a host before execution; narrative notes are preserved but not executable predicates. */
export function checkResearchTaskCall(task: ResearchTaskSpec, tool: string, parameters: Record<string, unknown>): string | null {
  if (tool === "scan_mainboard") return "A main-board scan expands the declared symbol scope. Start a fresh discovery session without a declared research task.";
  if (!task.constraints.allowedTools.includes(tool)) return `Tool ${tool} is outside the declared research capabilities.`;
  if (tool === "score_benchmark" && task.scope.benchmark
    && (parameters.benchmark_symbol ?? DEFAULT_BENCHMARK_SYMBOL) !== task.scope.benchmark) return "Benchmark differs from the task.";
  if (ARCHIVABLE_PRICE_TOOLS.includes(tool) && parameters.market !== undefined
    && task.scope.market !== "mixed" && parameters.market !== task.scope.market) return "Analysis market differs from the task.";
  if (tool === "analyze_archived_bars") {
    if (task.scope.market !== "mixed" && parameters.market !== task.scope.market) return "Archived analysis market differs from the task.";
    try { validateObservationCutoff(parameters.observed_before as string); }
    catch { return "Archived analysis requires an exact UTC observation cutoff."; }
  }
  if (ARCHIVABLE_PRICE_TOOLS.includes(tool) && parameters.observed_before !== undefined) {
    if (task.scope.market !== "mixed" && parameters.market !== task.scope.market) return "Historical analysis market differs from the task.";
    if (typeof parameters.start !== "string" || typeof parameters.end !== "string") return "Historical analysis requires explicit price dates.";
    try { validateObservationCutoff(parameters.observed_before as string); }
    catch { return "Historical analysis requires an exact UTC observation cutoff."; }
  }
  for (const key of ["symbol", "benchmark_symbol", "benchmark"]) {
    const symbol = parameters[key];
    let canonical: string | null = null;
    try { if (typeof symbol === "string") canonical = tool === "fund_dca_backtest" && key === "symbol" ? normalizeFundSymbol(symbol) : normalizeSymbol(symbol); }
    catch (error) { return error instanceof Error ? error.message : "Invalid task instrument."; }
    if (key !== "symbol" && !task.scope.benchmark) continue;
    if (canonical && ![...task.scope.symbols, task.scope.benchmark].includes(canonical)) return `Instrument ${symbol} is outside the task scope.`;
    if (key !== "symbol" && canonical && task.scope.benchmark && canonical !== task.scope.benchmark) return "Benchmark differs from the task.";
  }
  for (const [key, bound] of [["start", task.scope.start], ["start_date", task.scope.start], ["end", task.scope.end], ["end_date", task.scope.end]] as const) {
    const date = parameters[key];
    if (typeof date === "string" && (!isDailyDate(date) || (key.startsWith("start") ? date < bound : date > bound))) return `Date ${key} is outside the task window.`;
  }
  return null;
}

function evidenceIssue(task: ResearchTaskSpec, operation: ResearchOperation): string | null {
  const denied = checkResearchTaskCall(task, operation.tool, operation.parameters);
  if (denied) return denied;
  if (!operation.references.length || operation.references.some(reference => !reference.available)) return "Matching archived observations are unavailable.";
  if (task.scope.benchmark && operation.tool === "show_dashboard"
    && (!operation.benchmarkSymbols?.length || operation.benchmarkSymbols.some(symbol => symbol !== task.scope.benchmark)))
    return "Benchmark differs from the task.";
  const unscopedBenchmarks = task.scope.benchmark ? [] : operation.tool === "show_dashboard" ? operation.benchmarkSymbols ?? []
    : operation.tool === "score_benchmark" ? [String(operation.parameters.benchmark_symbol ?? DEFAULT_BENCHMARK_SYMBOL)]
    : operation.comparison ? [operation.comparison.benchmark] : [];
  for (const { ref } of operation.references) {
    if (![...task.scope.symbols, task.scope.benchmark, ...unscopedBenchmarks].includes(String(ref.symbol))) return "Observed instrument is outside the task scope.";
    const pinned = task.dataRefs.find(item => item.kind === ref.kind && item.symbol === ref.symbol);
    if (pinned && (pinned.revision !== ref.revision || pinned.contentHash !== ref.contentHash)) return "Observation version differs from the declared input.";
  }
  const dates = operation.evaluatedDates ?? operation.references.flatMap(reference => Array.isArray(reference.ref.dates) ? reference.ref.dates : []);
  if (!dates.length || dates.some(date => typeof date !== "string" || !isDailyDate(date) || date < task.scope.start || date > task.scope.end)) return "Observation dates are outside the task window.";
  if (task.scope.benchmark && operation.comparison?.benchmark && task.scope.benchmark !== operation.comparison.benchmark) return "Comparison benchmark differs from the task.";
  if (operation.comparison && task.scope.portfolioRevision && operation.comparison.portfolioRevision !== task.scope.portfolioRevision) return "Comparison group revision differs from the task.";
  if (operation.comparison && task.scope.groupIds && canonical(operation.comparison.groups.map(group => group.id)) !== canonical(task.scope.groupIds)) return "Comparison group identities differ from the task.";
  return null;
}

export function projectResearchTask(entries: ResearchEntry[], operations: ResearchOperation[], availableTools: string[],
  verifyReport?: (ref: string, provenance: Record<string, unknown>) => boolean): {
  task: ResearchTaskState | null; errors: Array<{ entryId: string; reason: string }>;
} {
  let task: ResearchTaskState | null = null;
  const errors: Array<{ entryId: string; reason: string }> = [];
  const indexes = new Map(entries.map((entry, index) => [entry.id, index]));
  for (const entry of entries) {
    const message = entry.type === "message" ? record(entry.message) : undefined;
    const note = entry.type === "custom_message" ? entry : message?.role === "custom" ? message : undefined;
    if (note?.customType !== "research_task" && !(message?.role === "toolResult" && message.toolName === "research_task" && !message.isError)) continue;
    try {
      const raw = note?.customType === "research_task" ? record(note.details) : record(recordedResearchTaskAction(entry, entries));
      if (!raw && note?.customType !== "research_task") continue;
      if (!raw || raw.version !== 1 || raw.expectedRevision !== (task?.revision ?? null)) throw new Error(`Stale or invalid task revision. Read the current task; expectedRevision must be ${JSON.stringify(task?.revision ?? null)}${task ? "" : " (JSON null, not a string)"}.`);
      if (raw.type === "declare") {
        const spec = validateResearchTask(raw.task);
        const previous = task as ResearchTaskState | null;
        task = { spec, revision: entry.id, startedEntryId: previous?.spec.id === spec.id ? previous.startedEntryId : entry.id,
          status: "active", criteria: [], resolutions: previous?.spec.id === spec.id ? previous.resolutions : [], unresolved: [], reportRef: null, reportEntryId: null, reportAvailable: null, reasons: [] };
      } else if (raw.type === "cancel" && task && text(raw.reason)) {
        task.status = "cancelled"; task.revision = entry.id; task.reasons = [raw.reason];
      } else if (raw.type === "resolve" && task && task.status !== "cancelled" && text(raw.reason)) {
        const from = record(raw.from), to = record(raw.to);
        if (!from || !to || !text(from.callId) || !text(from.callEntryId) || !text(to.callId) || !text(to.callEntryId)) throw new Error("Invalid attempt reference.");
        const sourceRef = { callId: from.callId, callEntryId: from.callEntryId }, targetRef = { callId: to.callId, callEntryId: to.callEntryId };
        const sources = operations.filter(operation => attemptMatches(operation, sourceRef));
        const targets = operations.filter(operation => attemptMatches(operation, targetRef));
        const source = sources[0], target = targets[0];
        if (sources.length !== 1 || targets.length !== 1 || !source || !target
          || source.tool !== target.tool || canonical(source.parameters) !== canonical(target.parameters)
          || (indexes.get(source.callEntryId) ?? -1) <= (indexes.get(task.startedEntryId) ?? -1)
          || (indexes.get(target.callEntryId) ?? -1) <= (indexes.get(source.callEntryId) ?? -1)
          || !target.resultEntryId || (indexes.get(target.resultEntryId) ?? Infinity) >= (indexes.get(entry.id) ?? -1)
          || task.resolutions.some(item => canonical(item.from) === canonical(sourceRef))) throw new Error("Resolution requires one earlier unresolved attempt and a later matching verified result in this task.");
        task.resolutions.push({ entryId: entry.id, from: sourceRef, to: targetRef, reason: raw.reason, active: false }); task.revision = entry.id;
      } else throw new Error("Invalid task event.");
    } catch (error) { errors.push({ entryId: entry.id, reason: error instanceof Error ? error.message : String(error) }); }
  }
  if (!task) return { task, errors };
  const cancelled = task.status === "cancelled";
  const current = operations.filter(operation => (indexes.get(operation.callEntryId) ?? -1) > (indexes.get(task.startedEntryId) ?? Infinity));
  for (const resolution of task.resolutions) {
    const source = current.find(item => attemptMatches(item, resolution.from)), target = current.find(item => attemptMatches(item, resolution.to));
    resolution.active = Boolean(source && target && ["pending", "failed", "unverified"].includes(source.status) && target.status === "verified" && !evidenceIssue(task.spec, target));
  }
  task.criteria = task.spec.criteria.map(criterion => {
    const attempts = current.filter(operation => operation.tool === criterion.tool);
    const candidates = attempts.filter(operation => !differingParameters(operation, criterion.parameters).length);
    const match = candidates.findLast(operation => operation.status === "verified" && !evidenceIssue(task!.spec, operation)
      && criterion.metrics.every(label => operation.findings?.metrics.some(metric => metric.label === label && metric.value !== null)));
    const latest = attempts.at(-1);
    const missing = latest ? `Latest ${criterion.tool} attempt parameters differ: ${differingParameters(latest, criterion.parameters).join(", ")}. Compare the declared parameters with the recorded operation; acceptance remains unmet.` : "No matching research result yet.";
    return match ? { id: criterion.id, status: "satisfied", reason: "Matched parameters, scope, archived observations and required metrics.", evidence: { callEntryId: match.callEntryId, callId: match.callId } }
      : { id: criterion.id, status: candidates.length || !availableTools.includes(criterion.tool) ? "blocked" : "pending",
        reason: !availableTools.includes(criterion.tool) ? `Capability ${criterion.tool} is unavailable.` : candidates.length ? evidenceIssue(task!.spec, candidates.at(-1)!) ?? "No matching verified result with all required metrics." : missing, evidence: null };
  });
  task.unresolved = current.filter(operation => !["verified", "recorded"].includes(operation.status)
    && !task!.resolutions.some(resolution => resolution.active && attemptMatches(operation, resolution.from))).map(operation => ({ callEntryId: operation.callEntryId, callId: operation.callId }));
  // Required findings must agree on the exact observation for each object and role.
  const versions = new Map<string, string>();
  for (const criterion of task.criteria) {
    if (!criterion.evidence) continue;
    const operation = current.find(item => attemptMatches(item, criterion.evidence!))!;
    // A dashboard is an independently checked history of saved evaluations,
    // not one observation version to reconcile with current calculations.
    if (operation.tool === "show_dashboard") continue;
    for (const { ref } of operation.references) {
      const key = `${ref.kind}/${ref.symbol}`, version = `${ref.revision}/${ref.contentHash}`;
      if (versions.has(key) && versions.get(key) !== version) task.reasons.push(`Conflicting observation versions for ${ref.symbol}; pin inputs or revise the task.`);
      versions.set(key, version);
    }
  }
  if (task.spec.reportRequired) {
    let boundProvenance: Record<string, unknown> | null = null;
    for (const entry of entries) {
      const message = entry.type === "message" ? record(entry.message) : undefined;
      const note = entry.type === "custom_message" ? entry : message?.role === "custom" ? message : undefined;
      if (!note || !["artifact_export", "artifact_restore"].includes(String(note.customType))) continue;
      const details = record(note.details), provenance = record(details?.provenance);
      if (!text(details?.reportRef) || !provenance || provenance.scope !== "branch" || !strings(provenance.entryIds)) continue;
      const entryIds = provenance.entryIds;
      const selected = entryIds.map(id => entries.find(candidate => candidate.id === id));
      const required = [task.revision, ...task.criteria.flatMap(criterion => criterion.evidence ? [current.find(item => attemptMatches(item, criterion.evidence!))!.resultEntryId!] : [])];
      if (task.criteria.every(criterion => criterion.status === "satisfied") && required.every(id => entryIds.includes(id))
        && selected.every(Boolean) && provenance.leafId === selected.at(-1)?.id
        && selected.every((item, index) => record(item)?.parentId === (selected[index - 1]?.id ?? null))
        && createHash("sha256").update(JSON.stringify(selected)).digest("hex") === provenance.entryHash) {
        task.reportRef = details.reportRef;
        task.reportEntryId = entry.id;
        boundProvenance = provenance;
      }
    }
    if (!task.reportRef || !boundProvenance) task.reasons.push("No recorded report binds this task revision and all required results.");
    else {
      try { task.reportAvailable = verifyReport?.(task.reportRef, boundProvenance) ?? null; }
      catch { task.reportAvailable = false; }
      if (task.reportAvailable === false) task.reasons.push("Recorded task report version is unavailable or damaged.");
      else if (task.reportAvailable === null) task.reasons.push("Recorded task report version has not been checked by the host.");
    }
  }
  if (task.unresolved.length) task.reasons.push("Unresolved attempts remain; link matching verified retries explicitly.");
  task.status = cancelled ? "cancelled" : task.criteria.every(criterion => criterion.status === "satisfied") && !task.reasons.length ? "complete"
    : task.criteria.some(criterion => criterion.status === "blocked") || task.unresolved.length
      || task.reportRef && task.reportAvailable !== true
      || versions.size && task.reasons.some(reason => reason.startsWith("Conflicting")) ? "blocked" : "active";
  return { task, errors };
}

/** Validate a proposed journal event against current branch evidence before persistence. */
export function validateResearchTaskEvent(event: ResearchTaskEvent, entries: ResearchEntry[], operations: ResearchOperation[], availableTools: string[]): ResearchTaskState {
  const id = "proposed-task-event";
  if (entries.some(entry => entry.id === id)) throw new Error("Reserved task validation entry ID.");
  const result = projectResearchTask([...entries, { id, type: "custom_message", customType: "research_task", details: event }], operations, availableTools);
  const error = result.errors.find(item => item.entryId === id);
  if (error || !result.task) throw new Error(error?.reason ?? "Invalid task event.");
  if (event.type === "resolve" && !result.task.resolutions.find(item => item.entryId === id)?.active) throw new Error("Resolution target must have matching verified evidence.");
  return result.task;
}
