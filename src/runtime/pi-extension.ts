import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isDeepStrictEqual } from "node:util";
import { BUILTIN_TOOL_REGISTRY } from "../tools/registry.ts";
import { createResearchTaskTool, RESEARCH_TASK_GUIDANCE } from "../tools/research-task-tool.ts";
import { projectResearchState } from "../research/state.ts";
import { artifactReference, loadArtifactSnapshot } from "../storage/index.ts";
import { taskToolDenial } from "./research/task-tool-policy.ts";

/** A normal Pi extension: Pi owns the host, UI, providers, packages and journal. */
export default function quantExtension(pi: ExtensionAPI) {
  const read = (ctx: ExtensionContext) => {
    const entries = ctx.sessionManager.getBranch();
    const state = projectResearchState(entries, pi.getActiveTools(), undefined, (ref, provenance) => {
      const snapshot = loadArtifactSnapshot(ref);
      return !!snapshot?.meta.revision && artifactReference(snapshot.meta) === ref
        && isDeepStrictEqual(snapshot.meta.provenance, provenance);
    });
    return { entries, state };
  };
  // Keep Pi's own shell, editor and file tools, including their native renderers.
  for (const { tool } of BUILTIN_TOOL_REGISTRY.filter(entry => entry.enabledByDefault !== false && entry.domain !== "system")) {
    pi.registerTool({ ...tool, async execute(id, input, signal, update, ctx) {
      signal?.throwIfAborted();
      const denied = taskToolDenial(read(ctx).state.task, tool.name, input);
      if (denied) throw new Error(denied);
      signal?.throwIfAborted();
      return tool.execute(id, input, signal, update);
    } });
  }
  const research = createResearchTaskTool(async () => { throw new Error("Research tool requires a Pi session context."); });
  pi.registerTool({ ...research, exposure: "model-only", async execute(id, input, signal, update, ctx) {
    return createResearchTaskTool(async () => read(ctx)).execute(id, input, signal, update);
  } });
  // The hook also covers community and nested ctx.executeTool calls.
  pi.on("tool_call", (event, ctx) => {
    const reason = taskToolDenial(read(ctx).state.task, event.toolName, event.input);
    return reason ? { block: true, reason } : undefined;
  });
  pi.on("before_agent_start", event => ({ systemPrompt: event.systemPrompt
    + "\nYou are using JQ quantitative research tools. Preserve source dates, data versions and failed attempts. "
    + "Community results are not verified quant evidence. Never bypass a declared task using shell or plugin code. "
    + "Pi owns model configuration, resources and session controls.\n" + RESEARCH_TASK_GUIDANCE
    + "\nThis native Pi host has no JQ Auto Artifacts integration. Declare tasks with reportRequired: false; "
    + "explain this limitation if a saved verified report is required. Do not claim an automatically generated JQ report.\n" }));
}
