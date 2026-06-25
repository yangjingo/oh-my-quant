import { discoverSkills, type QuantSkill } from "../agent/src/skills.ts";
import { NodeExecutionEnv } from "../agent/src/pi/node.ts";
import type { CommandHandler } from "../cli/types.ts";
import { loadSettings } from "../storage/index.ts";
import { skillPaths, installSkills } from "./store.ts";

function sourceLabel(skill: QuantSkill): string {
  return `${skill.scope}/${skill.source}`;
}

async function loadSkillsFromContext(ctx: Parameters<CommandHandler>[2]): Promise<QuantSkill[]> {
  if (ctx.agentSession) return await ctx.agentSession.getSkills();
  const env = new NodeExecutionEnv({ cwd: process.cwd() });
  const settings = loadSettings();
  const discovered = await discoverSkills({
    cwd: process.cwd(),
    env,
    extraPaths: skillPaths(),
    integrations: settings.skillIntegrations,
  });
  return discovered.skills;
}

const SUBCOMMANDS = new Set(["list", "info", "run", "trigger", "install"]);

export const skillHandler: CommandHandler = async (flags, positional, ctx) => {
  const action = positional[0] || "list";

  if (action === "install") {
    const repo = positional[1] || String(flags.repo || "");
    if (!repo) {
      return {
        success: false,
        message: [
          "Use /skill install <owner/repo>",
          "",
          "Examples",
          "  /skill install LLMQuant/skills",
          "  /skill install tradermonty/claude-trading-skills",
        ].join("\n"),
      };
    }
    return installSkills(repo);
  }

  const skills = await loadSkillsFromContext(ctx);

  if (action === "info") {
    const name = positional[1] || String(flags.name || flags.skill || "");
    if (!name) return { success: false, message: "Choose a skill with /skill info <name>." };
    const skill = skills.find((entry) => entry.name === name);
    if (!skill) return { success: false, message: `Unknown skill "${name}". Run /skill to list available skills.` };
    return {
      success: true,
      message: [
        skill.name,
        `Source      ${sourceLabel(skill)}`,
        `Visible     ${skill.disableModelInvocation ? "explicit only" : "model + explicit"}`,
        `Location    ${skill.filePath}`,
        `Summary     ${skill.description}`,
      ].join("\n"),
      data: skill,
    };
  }

  if (action === "run" || action === "trigger") {
    const name = positional[1] || String(flags.name || flags.skill || "");
    if (!name) return { success: false, message: "Choose a skill with /skill:<name> or /skill run <name> [instructions]." };
    const extra = positional.slice(2).join(" ").trim() || undefined;
    if (!ctx.agentSession) return { success: false, message: "Running a skill needs an active agent session. Send any AI message first, then try again." };
    await ctx.agentSession.skill(name, extra);
    return {
      success: true,
      message: `Running ${name}${extra ? " with extra instructions." : "."}`,
    };
  }

  // Direct invocation: /skill:name [extra instructions]
  if (!SUBCOMMANDS.has(action)) {
    const name = action;
    const skill = skills.find((entry) => entry.name === name);
    if (!skill) return { success: false, message: `Unknown skill "${name}". Run /skill to list available skills.` };
    const extra = positional.slice(1).join(" ").trim() || undefined;
    if (!ctx.agentSession) return { success: false, message: "Running a skill needs an active agent session. Send any AI message first, then try again." };
    await ctx.agentSession.skill(name, extra);
    return {
      success: true,
      message: `Running ${name}${extra ? " with extra instructions." : "."}`,
    };
  }

  const filter = String(flags.scope || flags.source || "");
  const filtered = filter
    ? skills.filter((skill) => sourceLabel(skill).includes(filter) || skill.source === filter || skill.scope === filter)
    : skills;
  if (filtered.length === 0) {
    return {
      success: true,
      message: [
        "No skills found.",
        "",
        "Install skills:",
        "  /skill install LLMQuant/skills",
        "  /skill install tradermonty/claude-trading-skills",
      ].join("\n"),
    };
  }

  const lines = [
    `Skills (${filtered.length})`,
    ...filtered.map((skill) => `${skill.name.padEnd(24)} ${sourceLabel(skill).padEnd(12)} ${skill.description}`),
    "",
    "Use /skill info <name> for details",
    "Use /skill:<name> to invoke one",
    "Use /skill install <owner/repo> to install more",
  ];
  return { success: true, message: lines.join("\n"), data: filtered };
};
