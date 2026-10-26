import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readSkillSelection, resolveSkillsDir, updateSkillSelection } from "../../storage/index.ts";
import { installSkillRepository, type SkillFetch, type SkillInstallResult } from "../../skill/index.ts";
import { CURATED_SKILL_REPOSITORIES, curatedSkillRepository } from "../../skill/index.ts";
import { invalidateSkillDiscovery } from "../../agent/src/skills.ts";
import { loadSkillsFromDir } from "../../agent/src/pi-skills.ts";

const skillsDir = () => resolveSkillsDir();

const DEFAULT_REPO_DIRS = new Map(CURATED_SKILL_REPOSITORIES.map(entry => [entry.repo.replace("/", "-"), entry]));

export function skillPaths(): string[] {
  if (!existsSync(skillsDir())) return [];
  const selection = readSkillSelection();
  const paths: string[] = [];
  for (const entry of readdirSync(skillsDir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const curated = DEFAULT_REPO_DIRS.get(entry.name);
    const selected = selection[entry.name];
    if (selected && !curated) {
      paths.push(...repositorySkills(skillsDir(), entry.name).filter(skill => selected.includes(skill.name)).map(skill => skill.filePath));
      continue;
    }
    if (curated) {
      const repoPath = join(skillsDir(), entry.name);
      const nestedSkills = join(repoPath, "skills");
      for (const skill of curated.skills) {
        if (selected && !selected.includes(skill.name)) continue;
        const skillPath = join(nestedSkills, skill.name);
        if (existsSync(skillPath)) paths.push(skillPath);
      }
      continue;
    }
    const repoPath = join(skillsDir(), entry.name);
    const nestedSkills = join(repoPath, "skills");
    paths.push(existsSync(nestedSkills) ? nestedSkills : repoPath);
  }
  return paths;
}

function repositorySkills(root: string, directory: string) {
  const repoPath = join(root, directory), nested = join(repoPath, "skills");
  return loadSkillsFromDir({ dir: existsSync(nested) ? nested : repoPath, source: "local" }).skills;
}

/** Downloaded repositories are shared caches; selection controls what reaches Pi and the model. */
export function managedSkillCatalog(root = skillsDir()) {
  const selection = readSkillSelection(root);
  const entries = CURATED_SKILL_REPOSITORIES.flatMap(repo => repo.skills.map(skill => ({
    name: skill.name, repo: String(repo.repo), directory: repo.repo.replace("/", "-"),
    downloaded: existsSync(join(root, repo.repo.replace("/", "-"), "skills", skill.name, "SKILL.md")),
    selected: false,
  })));
  if (existsSync(root)) for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith(".") || DEFAULT_REPO_DIRS.has(dir.name)) continue;
    entries.push(...repositorySkills(root, dir.name).map(skill => ({ name: skill.name, repo: dir.name,
      directory: dir.name, downloaded: true, selected: false })));
  }
  return entries.map(entry => ({ ...entry, selected: entry.downloaded && (selection[entry.directory]?.includes(entry.name) ?? true) }));
}

export async function installSelectedSkills(names: string[], options: { root?: string; fetch?: SkillFetch; signal?: AbortSignal } = {}) {
  const root = options.root ?? skillsDir();
  const catalog = managedSkillCatalog(root);
  const requested = [...new Set(names)];
  const ambiguous = ambiguousSelection(catalog, requested);
  if (ambiguous) return { success: false, message: ambiguous };
  const unknown = requested.find(name => !catalog.some(entry => entry.name === name));
  if (unknown) return { success: false, message: `Unknown skill "${unknown}". Use /skill catalog to choose names.` };
  const messages: string[] = [];
  let success = true;
  for (const directory of new Set(catalog.filter(entry => requested.includes(entry.name)).map(entry => entry.directory))) {
    options.signal?.throwIfAborted();
    const chosen = catalog.filter(entry => entry.directory === directory && requested.includes(entry.name));
    const preset = DEFAULT_REPO_DIRS.get(directory);
    if (!existsSync(join(root, directory)) && preset) {
      // Publish a choice before the shared download: failure/cancellation or another
      // concurrent discovery must not activate unselected sibling workflows.
      updateSkillSelection(selection => { selection[directory] ??= []; }, root);
      const result = await installSkillRepository(root, preset.repo, options.fetch, options.signal, {
        revision: preset.revision, requiredFiles: chosen.map(skill => `skills/${skill.name}/SKILL.md`),
      });
      options.signal?.throwIfAborted();
      if (!result.success) { success = false; messages.push(result.message); continue; }
    }
    const available = new Set(repositorySkills(root, directory).map(skill => skill.name));
    const missing = chosen.filter(skill => !available.has(skill.name));
    if (missing.length) { success = false; messages.push(`Missing SKILL.md: ${missing.map(skill => skill.name).join(", ")}. Check the local repository.`); continue; }
    updateSkillSelection(selection => {
      const previous = selection[directory] ?? catalog.filter(entry => entry.directory === directory && entry.selected).map(entry => entry.name);
      selection[directory] = [...new Set([...previous, ...chosen.map(skill => skill.name)])];
    }, root);
    invalidateSkillDiscovery();
    messages.push(`Selected ${chosen.map(skill => skill.name).join(", ")}. Shared repository files are cached; only selected skills are loaded.`);
  }
  return { success, message: messages.join("\n") };
}

export function removeSelectedSkills(names: string[]) {
  const catalog = managedSkillCatalog(), requested = [...new Set(names)];
  const ambiguous = ambiguousSelection(catalog, requested);
  if (ambiguous) return { success: false, message: ambiguous };
  const unknown = requested.find(name => !catalog.some(entry => entry.name === name && entry.downloaded));
  if (unknown) return { success: false, message: `Skill "${unknown}" is not installed by JQ. Project and external skills remain managed at their original location.` };
  updateSkillSelection(selection => {
    for (const directory of new Set(catalog.filter(entry => requested.includes(entry.name)).map(entry => entry.directory))) {
      const previous = selection[directory] ?? catalog.filter(entry => entry.directory === directory && entry.selected).map(entry => entry.name);
      selection[directory] = previous.filter(name => !requested.includes(name));
    }
  });
  invalidateSkillDiscovery();
  return { success: true, message: `Removed from JQ loading: ${requested.join(", ")}. Shared source files and local edits are retained. Use /skill install NAME to restore.` };
}

function ambiguousSelection(catalog: { name: string; directory: string }[], names: string[]): string | undefined {
  for (const name of names) {
    const sources = catalog.filter(entry => entry.name === name);
    if (sources.length > 1) return `Ambiguous skill "${name}" in ${sources.map(entry => entry.directory).join(", ")}. Resolve duplicate names in the source repositories first.`;
  }
  return undefined;
}

export async function installSkills(repo: string, signal?: AbortSignal): Promise<SkillInstallResult> {
  const curated = curatedSkillRepository(repo);
  const result = await installSkillRepository(skillsDir(), curated?.repo ?? repo, undefined, signal, curated ? {
    revision: curated.revision, requiredFiles: curated.skills.map(skill => `skills/${skill.name}/SKILL.md`),
  } : undefined);
  if (result.success) invalidateSkillDiscovery();
  return result;
}
