import { createAgent, type QuantAgentOptions, type QuantAgentSession } from "../agent/src/session.ts";
import { createDefaultSessionDependencies } from "./session-dependencies.ts";
import { checkResearchTaskCall, validateResearchTaskEvent } from "../research/tasks.ts";
import { validatePortfolioTaskDeclaration } from "../research/task-portfolio-scope.ts";
import type { ResearchTaskEvent, ResearchTaskSpec } from "../types/research-task.ts";
import { record } from "../research/references.ts";
import { RESEARCH_TASK_GUIDANCE } from "../tools/research-task-tool.ts";
import { bindResearchTools } from "../tools/registry.ts";
import { projectResearchState } from "../research/state.ts";
import type { ResearchState } from "../research/state.ts";
import type { AgentTool } from "../agent/src/session-runtime/index.ts";

function taskToolDenial(task: ResearchState["task"], toolName: string, input: unknown): string | null {
  if (!task || toolName === "research_task") return null;
  if (task.status === "cancelled") return "Research task is cancelled. Declare a new task before continuing.";
  const parameters = record(input);
  if (!parameters) return "Research task tools require object parameters.";
  return checkResearchTaskCall(task.spec, toolName, parameters);
}

/** Quant policy around the existing Pi session; no replacement loop or parallel state store. */
export function createQuantResearchAgent(options: QuantAgentOptions = {}): QuantAgentSession {
  const dependencies = options.dependencies ?? createDefaultSessionDependencies(options);
  let agent: QuantAgentSession;
  const bind = (source: readonly AgentTool[]) => bindResearchTools(source.map(tool => ({ ...tool,
    async execute(...args: Parameters<typeof tool.execute>) {
      args[2]?.throwIfAborted();
      const task = (await agent.getResearchState()).task;
      const denied = taskToolDenial(task, tool.name, args[1]);
      if (denied) throw new Error(denied);
      args[2]?.throwIfAborted();
      return tool.execute(...args);
    },
  })), async () => {
    const entries = await agent.getSessionBranch();
    return { entries, state: projectResearchState(entries, agent.state.tools.map(tool => tool.name), dependencies.verifyResearch, dependencies.verifyReport) };
  });
  agent = createAgent({ ...options, dependencies: { ...dependencies, tools: bind(dependencies.tools),
    beforeToolCall: async call => {
      const hostResult = await dependencies.beforeToolCall?.(call);
      if (hostResult?.block) return hostResult;
      const denied = taskToolDenial((await agent.getResearchState()).task, call.toolName, call.input);
      return denied ? { block: true, reason: denied, terminate: true } : hostResult;
    },
    prepareRequestResources: input => {
      const prepared = dependencies.prepareRequestResources?.(input) ?? { activeToolNames: input.research.availableTools, skills: input.skills };
      const task = input.research.task;
      if (!task) return prepared;
      const allowed = new Set(task.status === "cancelled" ? [] : task.spec.constraints.allowedTools);
      const activeToolNames = prepared.activeToolNames.filter(name => name === "research_task" || allowed.has(name));
      return { activeToolNames, skills: prepared.skills };
    },
    ...(dependencies.readTools ? { readTools: () => { const snapshot = dependencies.readTools!(); return { ...snapshot, tools: bind(snapshot.tools) }; } } : {}),
    prompts: { ...dependencies.prompts, system: input => dependencies.prompts.system(input)
      + (input.tools.some(tool => tool.name === "research_task") ? RESEARCH_TASK_GUIDANCE : "") },
  } });
  return agent;
}

export class QuantResearchHarness {
  private readonly agent: QuantAgentSession;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(agent: QuantAgentSession) { this.agent = agent; }

  getState() { return this.agent.getResearchState(); }

  /** Caller supplies the revision it reviewed. Failed validation never appends a declaration. */
  update(event: ResearchTaskEvent, signal?: AbortSignal) {
    const snapshot = structuredClone(event);
    const operation = this.writes.catch(() => {}).then(async () => {
      signal?.throwIfAborted();
      await this.agent.waitForIdle();
      signal?.throwIfAborted();
      const entries = await this.agent.getSessionBranch();
      const state = await this.agent.getResearchState();
      validatePortfolioTaskDeclaration(snapshot, state.operations);
      const next = validateResearchTaskEvent(snapshot, entries, state.operations, state.availableTools);
      signal?.throwIfAborted();
      await this.agent.appendContextNote("research_task", `Research task ${snapshot.type}: ${next.spec.goal}`, snapshot);
      const persisted = await this.agent.getResearchState();
      if (persisted.task?.revision === state.task?.revision || persisted.taskErrors.length > state.taskErrors.length) throw new Error("Task update conflicted with the current branch; reload its state.");
      return persisted;
    });
    this.writes = operation;
    return operation;
  }

  async run(task: ResearchTaskSpec, expectedRevision: string | null = null, signal?: AbortSignal) {
    const snapshot = structuredClone(task);
    await this.update({ version: 1, type: "declare", expectedRevision, task: snapshot }, signal);
    signal?.throwIfAborted();
    await this.agent.prompt(snapshot.request, { signal });
    return this.getState();
  }
}
