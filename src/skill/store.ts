import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { OHQUANT_DIR } from "../storage/index.ts";

export const SKILLS_DIR = process.env.OHQUANT_SKILLS_DIR || join(OHQUANT_DIR, "skills");

const DEFAULT_REPOS = [
  "LLMQuant/skills",
  "tradermonty/claude-trading-skills",
];

export const CORE_SKILL_NAMES = [
  "llmquant-data",
  "llmquant-macro",
  "llmquant-equities",
  "llmquant-portfolio",
  "llmquant-risk",
  "market-breadth-analyzer",
  "technical-analyst",
  "position-sizer",
  "macro-regime-detector",
  "market-environment-analysis",
];

export function skillPaths(): string[] {
  const paths: string[] = [];
  if (existsSync(SKILLS_DIR)) paths.push(SKILLS_DIR);
  return paths;
}

export function installSkills(repo: string): { success: boolean; message: string } {
  const target = join(SKILLS_DIR, repo.replace("/", "-"));
  const url = `https://github.com/${repo}.git`;

  if (existsSync(target)) {
    try {
      execSync(`git -C "${target}" pull --ff-only`, { stdio: "pipe", timeout: 30_000 });
      return { success: true, message: `Updated ${repo} in ${target}` };
    } catch {
      rmSync(target, { recursive: true, force: true });
    }
  }

  mkdirSync(SKILLS_DIR, { recursive: true });
  try {
    execSync(`git clone --depth 1 --filter=blob:none "${url}" "${target}"`, { stdio: "pipe", timeout: 60_000 });
    return { success: true, message: `Installed ${repo} → ${target}\nUse /skill to see new skills.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Clone failed: ${msg}` };
  }
}

/** Install default skill repos on first run (idempotent). */
export function ensureDefaultSkills(): void {
  mkdirSync(OHQUANT_DIR, { recursive: true });
  mkdirSync(SKILLS_DIR, { recursive: true });

  for (const repo of DEFAULT_REPOS) {
    const target = join(SKILLS_DIR, repo.replace("/", "-"));
    if (existsSync(target)) continue;

    const url = `https://github.com/${repo}.git`;
    try {
      execSync(`git clone --depth 1 --filter=blob:none "${url}" "${target}"`, { stdio: "pipe", timeout: 60_000 });
    } catch { /* silent */ }
  }
}
