import type { ResearchState } from "../../research/state.ts";
import { checkResearchTaskCall } from "../../research/tasks.ts";
import { record } from "../../research/references.ts";

/** Shared by the JQ session and native Pi tool_call hooks. */
export function taskToolDenial(task: ResearchState["task"], toolName: string, input: unknown): string | null {
  if (!task || toolName === "research_task") return null;
  if (task.status === "cancelled") return "Research task is cancelled. Declare a new task before continuing.";
  const parameters = record(input);
  if (!parameters) return "Research task tools require object parameters.";
  return checkResearchTaskCall(task.spec, toolName, parameters);
}
