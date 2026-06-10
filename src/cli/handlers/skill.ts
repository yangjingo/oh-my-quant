import { discoverSkills, type QuantSkill } from "../../agent/skills.ts";
import { NodeExecutionEnv } from "../../agent/pi/node.ts";
import type { CommandHandler } from "../types.ts";

function sourceLabel(skill: QuantSkill): string {
  return `${skill.scope}/${skill.source}`;
}

async function loadSkillsFromContext(ctx: Parameters<CommandHandler>[2]): Promise<QuantSkill[]> {
  if (ctx.agentSession) return await ctx.agentSession.getSkills();
  const env = new NodeExecutionEnv({ cwd: process.cwd() });
  const discovered = await discoverSkills({ cwd: process.cwd(), env });
  return discovered.skills;
}

export const skillHandler: CommandHandler = async (flags, positional, ctx) => {
  const action = positional[0] || "list";
  const skills = await loadSkillsFromContext(ctx);

  if (action === "info") {
    const name = positional[1] || String(flags.name || flags.skill || "");
    if (!name) return { success: false, message: "Usage: /skill info <name>" };
    const skill = skills.find((entry) => entry.name === name);
    if (!skill) return { success: false, message: `Unknown skill: ${name}. Use /skill.` };
    return {
      success: true,
      message: [
        skill.name,
        "────────────────────",
        `Source:      ${sourceLabel(skill)}`,
        `Visible:     ${skill.disableModelInvocation ? "explicit only" : "model + explicit"}`,
        `Location:    ${skill.filePath}`,
        `Description: ${skill.description}`,
      ].join("\n"),
      data: skill,
    };
  }

  if (action === "run" || action === "trigger") {
    const name = positional[1] || String(flags.name || flags.skill || "");
    if (!name) return { success: false, message: "Usage: /skill:whyj-quant or /skill run <name> [instructions]" };
    const extra = positional.slice(2).join(" ").trim() || undefined;
    if (!ctx.agentSession) return { success: false, message: "Agent session is not initialized yet." };
    await ctx.agentSession.skill(name, extra);
    return {
      success: true,
      message: `Running skill ${name}${extra ? " with extra instructions." : "."}`,
    };
  }

  const filter = String(flags.scope || flags.source || "");
  const filtered = filter
    ? skills.filter((skill) => sourceLabel(skill).includes(filter) || skill.source === filter || skill.scope === filter)
    : skills;
  if (filtered.length === 0) {
    return {
      success: true,
      message: "No skills found. Checked project .agents/.pi skill dirs and user .agents/.pi/.codex skill dirs.",
    };
  }

  const lines = [
    `Skills (${filtered.length})`,
    "────────────────────",
    ...filtered.map((skill) => `${skill.name.padEnd(24)} ${sourceLabel(skill).padEnd(12)} ${skill.description}`),
    "",
    "Use /skill info <name> for details.",
    "Use /skill:<name> to invoke a skill explicitly.",
  ];
  return { success: true, message: lines.join("\n"), data: filtered };
};
