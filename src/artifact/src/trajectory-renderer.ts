/**
 * Trajectory HTML rendering — timeline view with color-coded content blocks.
 * Style references traj-weaver skill (harness-traj-weaver):
 *   user=coral, assistant=teal, tool=amber, thinking=muted.
 * Tool inputs/outputs are collapsible; thinking truncated at 3000 chars.
 */
import { esc } from "./template.ts";
import type { TrajectoryDocument, TrajectorySummary } from "./types.ts";

export function renderTrajectoryDocument(traj: TrajectoryDocument): string {
  const parts: string[] = [];
  parts.push(renderTrajSummaryBar(traj.summary));
  parts.push(`<div class="traj-timeline">${renderTrajTimeline(traj)}</div>`);
  return parts.join("\n");
}

// ── Summary bar ──

function renderTrajSummaryBar(s: TrajectorySummary): string {
  const toolsList = s.toolsUsed.length > 0
    ? s.toolsUsed.map((t) => `<code>${esc(t)}</code>`).join(", ")
    : "-";
  return `<div class="traj-summary-bar">
    <span><strong>${s.totalEvents}</strong> events</span>
    <span><strong>${s.toolCallCount}</strong> tool calls</span>
    <span>${s.successToolCallCount} ok / ${s.failedToolCallCount} fail</span>
    <span class="traj-tools">${toolsList}</span>
  </div>`;
}

// ── Timeline ──

function renderTrajTimeline(traj: TrajectoryDocument): string {
  const blocks: string[] = [];
  let lastRole = "";

  for (const entry of traj.events) {
    if (entry.visibility === "hidden") continue;

    switch (entry.type) {
      case "user_request":
        lastRole = "user";
        blocks.push(renderBlock("user", entry.summary || entry.title, entry.timestamp));
        break;
      case "tool_call":
        lastRole = "tool";
        blocks.push(renderToolBlock(entry.title, entry.tool?.args, entry.tool?.callId, entry.timestamp, entry.redaction?.hasRedaction));
        break;
      case "tool_result":
        lastRole = "tool";
        blocks.push(renderResultBlock(entry.title, entry.tool?.resultPreview, entry.timestamp));
        break;
      case "observation":
      case "final_answer":
        lastRole = "assistant";
        blocks.push(renderBlock("assistant", entry.summary || entry.title, entry.timestamp));
        break;
      case "task_understanding":
      case "plan":
      case "step_start":
      case "decision":
      case "retry":
      case "warning":
        blocks.push(renderBlock("meta", entry.summary || entry.title, entry.timestamp));
        break;
      default:
        // artifact_write etc — skip in timeline
        break;
    }
  }
  return blocks.join("\n");
}

// ── Block renderers ──

function renderBlock(role: string, text: string, ts?: string): string {
  if (!text) return "";
  const truncated = text.length > 2000 ? text.slice(0, 2000) + "…" : text;
  return `<div class="traj-blk traj-${role}">
    <div class="traj-blk-body">${esc(truncated)}</div>
  </div>`;
}

function renderToolBlock(name: string, args: unknown, callId?: string, ts?: string, redacted?: boolean): string {
  const argsPreview = args ? JSON.stringify(args, null, 2) : "";
  const label = redacted ? `${esc(name)} <span class="traj-redacted">[redacted]</span>` : esc(name);
  return `<details class="traj-blk traj-tool">
    <summary><span class="traj-tool-name">${label}</span></summary>
    ${argsPreview ? `<pre class="traj-tool-args">${esc(argsPreview)}</pre>` : ""}
  </details>`;
}

function renderResultBlock(name: string, preview: unknown, ts?: string): string {
  const text = typeof preview === "string" ? preview : JSON.stringify(preview ?? {}, null, 2);
  if (!text || text === "{}") return "";
  const truncated = text.length > 3000 ? text.slice(0, 3000) + "\n…" : text;
  return `<div class="traj-blk traj-result">
    <div class="traj-result-label">${esc(name)}</div>
    <pre class="traj-result-body">${esc(truncated)}</pre>
  </div>`;
}
