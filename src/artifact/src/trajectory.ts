/**
 * Structured trajectory builder — converts raw session JSONL entries into
 * TrajectoryDocument with typed TrajectoryEvents.
 *
 * Per docs/artifacts-design.md Section 8: trajectory events are derived
 * from existing session format (no runtime recorder yet in MVP).
 */
import type { RawEntry, ContentBlock, TrajectoryDocument, TrajectoryEvent, TrajectorySummary } from "./types.ts";
import { redactEventToolArgs } from "./redact.ts";
import { extractText } from "./generator.ts";

const SKILL_NAME_RE = /<skill\s+name\s*=\s*"([^"]+)"/;

export function buildTrajectoryFromSession(
  entries: RawEntry[],
  sessionId: string,
  runId: string,
  mode: "compact" | "audit" | "debug" | "raw" = "compact",
): TrajectoryDocument {
  const events: TrajectoryEvent[] = [];
  let stepIdx = 0;

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message as Record<string, unknown> | undefined;
    if (!msg || typeof msg.role !== "string") continue;
    const role = String(msg.role);
    const ts = typeof entry.timestamp === "string" ? entry.timestamp : "";

    if (role === "user" || role === "displayUser") {
      const text = extractText(msg.content);
      const clean = text ? text.replace(/<skill\b[\s\S]*?(?:<\/skill>|\/?>)/g, "").trim() : "";
      if (clean) {
        stepIdx++;
        events.push({
          id: `evt_${stepIdx}`, runId, sessionId, timestamp: ts,
          type: "user_request", title: "用户请求",
          summary: clean.length > 300 ? clean.slice(0, 300) + "…" : clean,
          visibility: "public",
        });
      }
    } else if (role === "assistant") {
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const block of content as ContentBlock[]) {
          if (block.type === "text" && block.text && block.text.trim()) {
            stepIdx++;
            events.push({
              id: `evt_${stepIdx}`, runId, sessionId, timestamp: ts,
              type: "observation", title: "分析输出",
              summary: block.text.length > 300 ? block.text.slice(0, 300) + "…" : block.text,
              raw: block.text,
              visibility: "public",
            });
          } else if (block.type === "toolCall") {
            stepIdx++;
            const name = String(block.name || "");
            const argsPreview = formatToolArgsPreview(block.arguments);
            const isSkill = name === "Skill" || name.includes("skill");
            let skillName = "";
            if (name === "Skill" && argsPreview) {
              const sm = argsPreview.match(SKILL_NAME_RE);
              if (sm) skillName = sm[1]!;
            }
            events.push({
              id: `evt_${stepIdx}`, runId, sessionId, timestamp: ts,
              type: "tool_call",
              title: isSkill && skillName ? `Skill: ${skillName}` : name,
              tool: { callId: `call_${stepIdx}`, name: isSkill && skillName ? skillName : name, args: block.arguments, argsPreview: skillName || argsPreview },
              visibility: "debug",
            });
          }
        }
      }
    } else if (role === "toolResult") {
      stepIdx++;
      const toolName = typeof msg.toolName === "string" ? msg.toolName : "unknown";
      const text = extractText(msg.content);
      events.push({
        id: `evt_${stepIdx}`, runId, sessionId, timestamp: ts,
        type: "tool_result",
        title: toolName,
        tool: { callId: `call_${stepIdx}`, name: toolName, args: {}, resultPreview: text ? text.slice(0, 500) : undefined },
        status: "success",
        visibility: "debug",
      });
    }
  }

  // Apply redaction to all events with tool args
  const redactedEvents = events.map(redactEventToolArgs);

  return {
    runId, sessionId, mode,
    events: redactedEvents,
    summary: computeTrajectorySummary(redactedEvents),
  };
}

export function computeTrajectorySummary(events: TrajectoryEvent[]): TrajectorySummary {
  const toolCalls = events.filter((e) => e.type === "tool_call");
  const warnings = events.filter((e) => e.type === "warning");
  const evidenceItems = events.flatMap((e) => e.evidence ?? []);
  return {
    totalEvents: events.length,
    toolCallCount: toolCalls.length,
    successToolCallCount: events.filter((e) => e.type === "tool_result" && e.status !== "error").length,
    failedToolCallCount: events.filter((e) => e.type === "tool_result" && e.status === "error").length,
    retryCount: events.filter((e) => e.type === "retry").length,
    warningCount: warnings.length,
    toolsUsed: [...new Set(toolCalls.map((e) => e.tool?.name).filter(Boolean))] as string[],
    evidenceCount: evidenceItems.length,
  };
}

function formatToolArgsPreview(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const entries = Object.entries(a);
  if (entries.length === 0) return "";
  if (entries.length === 1) return String(entries[0]![1]);
  return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
}
