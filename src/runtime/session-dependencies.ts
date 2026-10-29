import type { OutputPresentation } from "../agent/src/system-prompt.ts";
import { NodeExecutionEnv } from "../agent/src/session-runtime/node.ts";
import { isDeepStrictEqual } from "node:util";
import { JsonlSessionRepo, type ThinkingLevel } from "../agent/src/session-runtime/index.ts";
import { BUILTIN_TOOLS } from "../tools/registry.ts";
import { artifactReference, ensureDirs, loadArtifactSnapshot, loadSettings, readWhyjEnvValue, resolveSessionsDir } from "../storage/index.ts";
import { buildSystemPrompt, injectSkillContext, injectTurnContext } from "../agent/src/context.ts";
import { buildResearchReport } from "../research/input.ts";
import { discoverSkills, skillDiscoveryRevision } from "../agent/src/skills.ts";
import { configuredThinking, resolveConfiguredAuth, resolveConfiguredModel, resolveCompactTriggerTokens, resolveModel } from "../agent/src/model-config.ts";
import type { QuantAgentDependencies, QuantAgentOptions, QuantModelConnection } from "../agent/src/session-contracts.ts";

function thinkingLevel(level: string): ThinkingLevel {
  return ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(level) ? level as ThinkingLevel : "off";
}

/** Local application composition; the session facade itself owns no settings or discovery IO. */
export function createDefaultSessionDependencies(options: QuantAgentOptions, presentation: OutputPresentation = "terminal"): QuantAgentDependencies {
  const cwd = options.cwd ?? process.cwd();
  const env = new NodeExecutionEnv({ cwd });
  const override = structuredClone(options.settings);
  const paths = options.skillPaths;
  const fixedPaths = typeof paths === "function" ? [] : [...(paths ?? [])];
  const skillPaths = typeof paths === "function" ? paths : () => fixedPaths;
  ensureDirs();
  const settings = () => {
    const base = loadSettings();
    return { ...base, env: { ...base.env, ...override?.env }, model: override?.model ?? base.model,
      provider: override?.provider ?? base.provider, providers: override?.providers ?? base.providers,
      thinkingLevel: override?.thinkingLevel ?? base.thinkingLevel, skillIntegrations: override?.skillIntegrations ?? base.skillIntegrations };
  };
  return {
    env, sessions: new JsonlSessionRepo({ fs: env, sessionsRoot: options.sessionsRoot ?? resolveSessionsDir() }),
    tools: BUILTIN_TOOLS,
    readConnection() {
      const config = structuredClone(settings()), processEnv = { ...process.env };
      const model = resolveConfiguredModel(config);
      const legacyEnv = { ...config.env, WHYJ_QUANT_BASE_URL: model.baseUrl,
        WHYJ_QUANT_CONTEXT_WINDOW: readWhyjEnvValue(config.env, "contextWindow") ?? readWhyjEnvValue(processEnv, "contextWindow") ?? "0" };
      const level = config.provider ? configuredThinking(config) : thinkingLevel(config.thinkingLevel || "high");
      const connection: QuantModelConnection = { model, thinkingLevel: level,
        compactTriggerTokens: resolveCompactTriggerTokens(config.env, model.contextWindow),
        async getAuth(activeModel, signal) {
          const result = await resolveConfiguredAuth(config, activeModel, processEnv, signal);
          if (!result) throw new Error(`Configure credentials for ${activeModel.provider} in /config → Model.`);
          return { ...result.auth, env: result.env };
        },
      };
      if (!config.provider) connection.restore = context => {
        let restoredModel = model;
        if (context.model) { try { restoredModel = resolveModel(context.model.provider, context.model.modelId, legacyEnv); } catch { /* Retain the configured model if an old entry cannot be resolved. */ } }
        return { model: restoredModel, thinkingLevel: context.thinkingLevel === null ? level : thinkingLevel(context.thinkingLevel) };
      };
      return connection;
    },
    readSkillRevision: () => JSON.stringify([skillDiscoveryRevision(), skillPaths(), settings().skillIntegrations]),
    async loadSkills() { return (await discoverSkills({ cwd, env, extraPaths: skillPaths(), integrations: settings().skillIntegrations })).skills; },
    prompts: { system: ({ tools, skills }) => buildSystemPrompt(undefined, skills, tools, presentation), turn: (input, ctx) => injectTurnContext(input, ctx, presentation), skill: (name, instructions) => injectSkillContext(name, instructions, presentation) },
    verifyResearch: buildResearchReport,
    verifyReport(ref, provenance) {
      const snapshot = loadArtifactSnapshot(ref);
      return !!snapshot?.meta.revision && artifactReference(snapshot.meta) === ref
        && isDeepStrictEqual(snapshot.meta.provenance, provenance);
    },
  };
}
