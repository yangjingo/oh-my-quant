import { expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { installSelectedSkills, managedSkillCatalog, removeSelectedSkills, skillPaths } from "../skills/skill-store.ts";
import { CURATED_SKILL_REPOSITORIES } from "../../skill/index.ts";
import { createDefaultSessionDependencies } from "../session-dependencies.ts";
import { skillArchive } from "../../skill/test/fixtures/archive.ts";

async function fixture(run: (root: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), "whyj-selected-skills-"));
  const previous = process.env.OHQUANT_SKILLS_DIR, previousState = process.env.OHQUANT_DIR;
  process.env.OHQUANT_DIR = join(root, "state");
  process.env.OHQUANT_SKILLS_DIR = join(root, "installed");
  mkdirSync(join(root, ".git"));
  try { await run(root); } finally {
    if (previous === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previous;
    if (previousState === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previousState;
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
}

function writeSkill(path: string, name: string) {
  mkdirSync(join(path, name), { recursive: true });
  writeFileSync(join(path, name, "SKILL.md"), `---\nname: ${name}\ndescription: Fixture workflow\n---\nLocal instructions`);
}

it("lists ten choices without creating or downloading anything", () => fixture(async () => {
  expect(managedSkillCatalog()).toHaveLength(10);
  expect(managedSkillCatalog().every(skill => !skill.selected && !skill.downloaded)).toBe(true);
  expect(existsSync(process.env.OHQUANT_SKILLS_DIR!)).toBe(false);
}));

it("downloads a shared repository once and exposes only the chosen skills to a composed session", () => fixture(async root => {
  const repository = CURATED_SKILL_REPOSITORIES[0]!;
  const local = createDefaultSessionDependencies({ cwd: root, skillPaths, settings: { skillIntegrations: { external: false } } });
  expect(await local.loadSkills()).toEqual([]);
  const before = local.readSkillRevision!(); let downloads = 0;
  const result = await installSelectedSkills(["llmquant-risk", "llmquant-data"], { fetch: async url => {
    expect(url).toEndWith(`/tarball/${repository.revision}`); downloads++;
    return new Response(skillArchive(Object.fromEntries(repository.skills.map(skill => [
      `skills/${skill.name}/SKILL.md`, `---\nname: ${skill.name}\ndescription: Fixture workflow\n---\nLocal instructions`,
    ]))));
  } });
  expect(result.success).toBe(true); expect(downloads).toBe(1);
  expect(local.readSkillRevision!()).not.toBe(before);
  expect((await local.loadSkills()).map(skill => skill.name).sort()).toEqual(["llmquant-data", "llmquant-risk"]);
  expect(managedSkillCatalog().filter(skill => skill.selected).map(skill => skill.name).sort()).toEqual(["llmquant-data", "llmquant-risk"]);
  expect(managedSkillCatalog().find(skill => skill.name === "llmquant-macro")).toMatchObject({ downloaded: true, selected: false });
}));

it("persists individual removal, retains local edits and restores only the selected cached skill offline", () => fixture(async root => {
  const source = join(process.env.OHQUANT_SKILLS_DIR!, "LLMQuant-skills", "skills");
  for (const name of ["llmquant-risk", "llmquant-data"]) writeSkill(source, name);
  const file = join(source, "llmquant-risk", "SKILL.md"), original = readFileSync(file, "utf8");
  const local = createDefaultSessionDependencies({ cwd: root, skillPaths });
  expect((await local.loadSkills()).map(skill => skill.name).sort()).toEqual(["llmquant-data", "llmquant-risk"]);
  expect(removeSelectedSkills(["llmquant-risk"]).success).toBe(true);
  expect(readFileSync(file, "utf8")).toBe(original);
  expect((await local.loadSkills()).map(skill => skill.name)).toEqual(["llmquant-data"]);
  expect(JSON.parse(readFileSync(join(process.env.OHQUANT_SKILLS_DIR!, ".selection.json"), "utf8"))["LLMQuant-skills"]).toEqual(["llmquant-data"]);
  const result = await installSelectedSkills(["llmquant-risk"], { fetch: () => { throw new Error("Must stay offline"); } });
  expect(result.success).toBe(true);
  expect((await local.loadSkills()).map(skill => skill.name).sort()).toEqual(["llmquant-data", "llmquant-risk"]);
  expect(removeSelectedSkills(["llmquant-data", "llmquant-risk"]).success).toBe(true);
  expect(skillPaths()).toEqual([]);
}));

it("validates the whole selection before downloading or removing and does not adopt external skills", () => fixture(async () => {
  let calls = 0;
  const result = await installSelectedSkills(["llmquant-risk", "unknown"], { fetch: async () => { calls++; return new Response(); } });
  expect(result.success).toBe(false); expect(calls).toBe(0);
  expect(removeSelectedSkills(["external-skill"]).success).toBe(false);
  expect(existsSync(process.env.OHQUANT_SKILLS_DIR!)).toBe(false);
}));

it("does not select or download further repositories after cancellation", () => fixture(async () => {
  const abort = new AbortController(); let calls = 0;
  await expect(installSelectedSkills(["llmquant-risk", "technical-analyst"], { signal: abort.signal, fetch: async () => { calls++; abort.abort(); return new Response(); } })).rejects.toThrow();
  expect(calls).toBe(1);
  expect(JSON.parse(readFileSync(join(process.env.OHQUANT_SKILLS_DIR!, ".selection.json"), "utf8"))).toEqual({ "LLMQuant-skills": [] });
  expect(managedSkillCatalog().every(skill => !skill.selected)).toBe(true);
}));

it("preserves invalid selection files and refuses to download over an unreadable choice", () => fixture(async () => {
  mkdirSync(process.env.OHQUANT_SKILLS_DIR!);
  const file = join(process.env.OHQUANT_SKILLS_DIR!, ".selection.json");
  writeFileSync(file, "broken");
  let calls = 0;
  await expect(installSelectedSkills(["llmquant-risk"], { fetch: async () => { calls++; return new Response(); } })).rejects.toThrow("invalid");
  expect(calls).toBe(0); expect(readFileSync(file, "utf8")).toBe("broken");
}));

it("can remove and restore a skill from a custom repository without modifying its files", () => fixture(async () => {
  const source = join(process.env.OHQUANT_SKILLS_DIR!, "someone-workflows", "skills");
  writeSkill(source, "custom-one"); writeSkill(source, "custom-two");
  expect(removeSelectedSkills(["custom-one"]).success).toBe(true);
  expect(skillPaths()).toEqual([join(source, "custom-two", "SKILL.md")]);
  expect((await installSelectedSkills(["custom-one"])).success).toBe(true);
  expect(skillPaths().sort()).toEqual([join(source, "custom-one", "SKILL.md"), join(source, "custom-two", "SKILL.md")]);
}));

it("keeps a removed Markdown sibling out of the composed session", () => fixture(async root => {
  const source = join(process.env.OHQUANT_SKILLS_DIR!, "someone-workflows", "skills");
  mkdirSync(source, { recursive: true });
  for (const name of ["alpha", "beta"]) writeFileSync(join(source, `${name}.md`), `---\nname: ${name}\ndescription: Fixture workflow\n---\nInstructions`);
  const session = createDefaultSessionDependencies({ cwd: root, skillPaths, settings: { skillIntegrations: { external: false } } });
  expect((await session.loadSkills()).map(skill => skill.name).sort()).toEqual(["alpha", "beta"]);
  expect(removeSelectedSkills(["alpha"]).success).toBe(true);
  expect((await session.loadSkills()).map(skill => skill.name)).toEqual(["beta"]);
  expect((await installSelectedSkills(["alpha"], { fetch: () => { throw new Error("Must stay offline"); } })).success).toBe(true);
  expect((await session.loadSkills()).map(skill => skill.name).sort()).toEqual(["alpha", "beta"]);
}));

it("rejects ambiguous names before changing selections or downloading", () => fixture(async () => {
  for (const repo of ["someone-one", "someone-two"]) writeSkill(join(process.env.OHQUANT_SKILLS_DIR!, repo, "skills"), "duplicate");
  const install = await installSelectedSkills(["duplicate"], { fetch: () => { throw new Error("Must stay offline"); } });
  expect(install.success).toBe(false);
  expect(install.message).toContain("Ambiguous");
  expect(removeSelectedSkills(["duplicate"]).success).toBe(false);
  expect(existsSync(join(process.env.OHQUANT_SKILLS_DIR!, ".selection.json"))).toBe(false);
  expect(managedSkillCatalog().filter(skill => skill.name === "duplicate").every(skill => skill.selected)).toBe(true);
}));
