import type { CommandHandler } from "../../types/commands.ts";
import { installSkills, installSelectedSkills, managedSkillCatalog, removeSelectedSkills } from "../../runtime/skills/skill-store.ts";
import { CURATED_SKILL_REPOSITORIES } from "../../skill/index.ts";
import { discoverRuntimeSkills } from "../../runtime/skills/skill-discovery.ts";
import { invalidateSkillDiscovery } from "../../agent/src/skills.ts";
import { readChartImage } from "../../runtime/models/chart-image-input.ts";

export const skillHandler: CommandHandler = async (flags, positional, ctx) => {
  const action = positional[0] || "list";
  ctx.commandSignal?.throwIfAborted();
  if (action === "catalog" || action === "install" && positional.length === 1 && !flags.repo && !flags.all) {
    const catalog = managedSkillCatalog();
    return { success: true, data: catalog, message: ["Choose skills to install (nothing is downloaded by this listing):",
      ...catalog.map(skill => `${skill.name} [${skill.selected ? "selected" : skill.downloaded ? "cached" : "available"}]: ${skill.repo}`),
      "Use /skill install NAME [NAME ...], /skill install --all, or /skill remove NAME [NAME ...].",
    ].join("\n") };
  }
  if (action === "install") {
    const repo = flags.repo || (positional[1]?.includes("/") ? positional[1] : undefined);
    if (repo) return installSkills(String(repo), ctx.commandSignal);
    const names = flags.all ? CURATED_SKILL_REPOSITORIES.flatMap(repo => repo.skills.map(skill => skill.name)) : positional.slice(1);
    return installSelectedSkills(names, { signal: ctx.commandSignal });
  }
  if (action === "remove") return removeSelectedSkills(positional.slice(1));
  if (action === "reload") invalidateSkillDiscovery();
  const skills = ctx.skillCatalog ? await ctx.skillCatalog()
    : ctx.agentSession ? await ctx.agentSession.getSkills() : await discoverRuntimeSkills(ctx.cwd);
  if (action === "list" || action === "reload") {
    const filter = String(flags.scope || flags.source || "");
    const filtered = skills.filter(skill => !filter || `${skill.scope}/${skill.source}`.includes(filter));
    return { success: true, data: filtered, message: [
      filtered.length ? `Skills (${filtered.length})` : "No skills found. Use /skill install to choose presets.",
      ...filtered.map(skill => `${skill.name.padEnd(24)} ${skill.scope}/${skill.source}  ${skill.description}`),
      "Use /skill catalog, /skill install NAME, /skill remove NAME, /skill info NAME, /skill:NAME, or /skill reload.",
    ].join("\n") };
  }
  const explicit = ["info", "run", "trigger"].includes(action);
  const name = explicit ? positional[1] || String(flags.name || flags.skill || "") : action;
  if (!name) return { success: false, message: "Choose a skill with /skill info NAME or /skill run NAME." };
  const skill = skills.find(entry => entry.name === name);
  if (!skill) return { success: false, message: `Unknown skill "${name}". Run /skill to list available skills.` };
  if (action === "info") return { success: true, data: skill, message: [skill.name,
    `Source      ${skill.scope}/${skill.source}`, `Location    ${skill.filePath}`,
    `Visible     ${skill.disableModelInvocation ? "explicit only" : "model + explicit"}`,
    `Summary     ${skill.description}`, "Follow the upstream SKILL.md for inputs, credentials and dependencies.",
  ].join("\n") };
  if (!ctx.agentSession) return { success: false, message: "Running a skill needs an active agent session. Send any AI message first, then try again." };
  const extra = positional.slice(explicit ? 2 : 1).join(" ").trim() || undefined;
  const images = flags.image !== undefined ? [await readChartImage(String(flags.image), ctx.commandSignal)] : undefined;
  await ctx.agentSession.skill(name, extra, { images, signal: ctx.commandSignal });
  ctx.commandSignal?.throwIfAborted();
  return { success: true, message: `Running ${name}${extra ? " with extra instructions." : "."}` };
};
