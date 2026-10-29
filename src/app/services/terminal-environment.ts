import type { QuantAgentDependencies } from "../../agent/src/session-contracts.ts";
import { RuntimeExtensions } from "../../runtime/extensions.ts";
import { extensionSessionDependencies } from "../../runtime/extension-session.ts";
import { withSinglePortfolioResearch, type ResearchPortfolioSelection } from "../../runtime/research/active-portfolio.ts";
import { skillPaths } from "../../runtime/skills/skill-store.ts";
import { createDefaultSessionDependencies } from "../../runtime/session-dependencies.ts";
import type { ExtensionAction } from "../../types/commands.ts";

/** One Host-owned extension registry; a terminal view never owns its lifetime. */
export class TerminalEnvironment {
  private extensions?: RuntimeExtensions;
  private initialization?: Promise<void>;
  private closed = false;

  private async runtime(cwd: string, base: QuantAgentDependencies) {
    if (this.closed) throw new Error("Terminal execution environment is closed.");
    this.extensions ??= new RuntimeExtensions({ cwd });
    const extensions = this.extensions;
    this.initialization ??= (async () => {
      await extensions.host.reserve({ tools: ["ask_user"], skills: (await base.loadSkills()).map(skill => skill.name),
        capabilities: Object.keys(base.readSkillCapabilities?.() ?? {}) });
      await extensions.start();
    })();
    await this.initialization;
    if (this.closed) throw new Error("Terminal execution environment is closed.");
    return extensions;
  }

  async dependencies(cwd: string, supplied?: () => QuantAgentDependencies, selection?: ResearchPortfolioSelection) {
    if (this.closed) throw new Error("Terminal execution environment is closed.");
    const base = supplied?.() ?? createDefaultSessionDependencies({ cwd, skillPaths });
    try {
      // Injected dependencies already describe a complete, isolated test/runtime port.
      if (supplied) return withSinglePortfolioResearch(base, selection);
      const extensions = await this.runtime(cwd, base);
      return withSinglePortfolioResearch(await extensionSessionDependencies(base, extensions.host), selection);
    } catch (error) { await base.env.cleanup().catch(() => {}); throw error; }
  }

  async close() {
    this.closed = true;
    await this.extensions?.dispose();
    await Promise.allSettled([this.initialization]);
  }

  async manage(cwd: string, action: ExtensionAction, id?: string, signal?: AbortSignal, supplied?: () => QuantAgentDependencies) {
    signal?.throwIfAborted();
    if (supplied) return { success: false, message: "The supplied execution environment does not provide extension management." };
    const base = createDefaultSessionDependencies({ cwd, skillPaths });
    try {
      const extensions = await this.runtime(cwd, base);
      signal?.throwIfAborted();
      if (action === "enable" || action === "reload") await extensions.host.reserve({
        skills: (await base.loadSkills()).map(skill => skill.name),
        capabilities: Object.keys(base.readSkillCapabilities?.() ?? {}),
      });
      return await extensions.manage(action, id, signal);
    } finally { await base.env.cleanup(); }
  }

  /** Management lists enabled resources; invocation still applies Agent request policy. */
  async catalog(cwd: string, supplied?: () => QuantAgentDependencies) {
    const dependencies = await this.dependencies(cwd, supplied);
    try {
      const skills = [...await dependencies.loadSkills(), ...(dependencies.readTools?.().skills ?? [])];
      if (new Set(skills.map(skill => skill.name)).size !== skills.length) throw new Error("Duplicate skill names in terminal resources.");
      return structuredClone(skills);
    } finally { await dependencies.env.cleanup(); }
  }
}
