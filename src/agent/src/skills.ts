import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { FileError, loadSourcedSkills, type ExecutionEnv, type FileInfo, type Result, type Skill, type SkillDiagnostic } from "./pi/index.ts";
import type { NodeExecutionEnv } from "./pi/node.ts";
import type { SkillIntegrationSettings } from "../../types/config.ts";
import { perfLog, perfNow } from "../../perf.ts";

export interface QuantSkill extends Skill {
  scope: "project" | "user";
  source: "agents" | "claude" | "codex" | "pi";
  sourcePath: string;
}

export interface QuantSkillDiagnostic extends SkillDiagnostic {
  scope: "project" | "user";
  source: "agents" | "claude" | "codex" | "pi";
  sourcePath: string;
}

interface SkillSource {
  path: string;
  scope: "project" | "user";
  source: "agents" | "claude" | "codex" | "pi";
}

export interface DiscoverSkillsOptions {
  cwd: string;
  env: NodeExecutionEnv;
  extraPaths?: string[];
  integrations?: Partial<SkillIntegrationSettings>;
}

type DiscoverSkillsResult = { skills: QuantSkill[]; diagnostics: QuantSkillDiagnostic[]; sources: SkillSource[] };

const discoveryCache = new Map<string, Promise<DiscoverSkillsResult>>();

export async function discoverSkills(
  options: DiscoverSkillsOptions,
): Promise<DiscoverSkillsResult> {
  const sources = resolveSkillSources(options.cwd, options.extraPaths, options.integrations);
  const cacheKey = discoveryCacheKey(sources);
  if (process.env.WHYJ_SKILL_CACHE?.toLowerCase() !== "off") {
    const cached = discoveryCache.get(cacheKey);
    if (cached) {
      const startedAt = perfNow();
      const result = await cached;
      perfLog("skills.cache", startedAt, { skills: result.skills.length, sources: result.sources.length });
      return cloneDiscoveryResult(result);
    }
  }

  const startedAt = perfNow();
  const env = createPosixSkillEnv(options.env);
  const loading = loadDiscoveredSkills(env, sources)
    .then((result) => {
      perfLog("skills.load", startedAt, { skills: result.skills.length, sources: result.sources.length });
      return result;
    })
    .catch((error) => {
      discoveryCache.delete(cacheKey);
      throw error;
    });
  if (process.env.WHYJ_SKILL_CACHE?.toLowerCase() !== "off") discoveryCache.set(cacheKey, loading);
  return cloneDiscoveryResult(await loading);
}

async function loadDiscoveredSkills(env: ExecutionEnv, sources: SkillSource[]): Promise<DiscoverSkillsResult> {
  const loaded = await loadSourcedSkills(
    env,
    sources.map((source) => ({ path: source.path, source })),
    (skill, source) => ({ ...skill, sourcePath: source.path, scope: source.scope, source: source.source }),
  );
  const seenNames = new Set<string>();
  const dedupedSkills = loaded.skills
    .map((entry) => entry.skill)
    .filter((skill) => {
      if (seenNames.has(skill.name)) return false;
      seenNames.add(skill.name);
      return true;
    });
  return {
    skills: dedupedSkills,
    diagnostics: loaded.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      sourcePath: diagnostic.source.path,
      scope: diagnostic.source.scope,
      source: diagnostic.source.source,
    })),
    sources,
  };
}

function cloneDiscoveryResult(result: DiscoverSkillsResult): DiscoverSkillsResult {
  return {
    skills: result.skills.map((skill) => ({ ...skill })),
    diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    sources: result.sources.map((source) => ({ ...source })),
  };
}

function discoveryCacheKey(sources: SkillSource[]): string {
  return sources
    .map((source) => `${source.scope}:${source.source}:${resolve(source.path)}`)
    .join("|");
}

function resolveSkillSources(
  cwd: string,
  extraPaths: string[] = [],
  integrations: Partial<SkillIntegrationSettings> = {},
): SkillSource[] {
  const userHome = homedir();
  const homeRoot = resolve(userHome);
  const projectRoots = collectAncestorRoots(cwd).filter((root) => resolve(root) !== homeRoot);
  const userSources: SkillSource[] = [];
  if (integrations.claude === true) {
    userSources.push(
      { path: join(userHome, ".claude", "skills"), scope: "user", source: "claude" },
      { path: join(userHome, ".agents", "skills"), scope: "user", source: "agents" },
      { path: join(userHome, ".pi", "agent", "skills"), scope: "user", source: "pi" },
    );
  }
  if (integrations.codex === true) {
    userSources.push({ path: join(userHome, ".codex", "skills"), scope: "user", source: "codex" });
  }
  const candidates: SkillSource[] = [
    ...projectRoots.flatMap((root) => ([
      { path: join(root, ".agents", "skills"), scope: "project" as const, source: "agents" as const },
      { path: join(root, ".pi", "skills"), scope: "project" as const, source: "pi" as const },
    ])),
    ...userSources,
    ...extraPaths.map((path) => ({ path: resolve(path), scope: "project" as const, source: "pi" as const })),
  ];

  const seen = new Set<string>();
  const sources: SkillSource[] = [];
  for (const candidate of candidates) {
    const normalized = resolve(candidate.path);
    if (seen.has(normalized) || !existsSync(normalized)) continue;
    seen.add(normalized);
    sources.push({ ...candidate, path: normalized });
  }
  return sources;
}

function collectAncestorRoots(cwd: string): string[] {
  const roots: string[] = [];
  let current = resolve(cwd);
  while (true) {
    roots.push(current);
    if (existsSync(join(current, ".git"))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

function createPosixSkillEnv(env: NodeExecutionEnv): ExecutionEnv {
  return {
    ...env,
    cwd: toPosixPath(env.cwd),
    async absolutePath(path) {
      return mapPathResult(await env.absolutePath(fromPosixPath(path)));
    },
    async joinPath(parts) {
      return mapPathResult(await env.joinPath(parts.map(fromPosixPath)));
    },
    async readTextFile(path, abortSignal) {
      return await env.readTextFile(fromPosixPath(path), abortSignal);
    },
    async readTextLines(path, options) {
      return await env.readTextLines(fromPosixPath(path), options);
    },
    async readBinaryFile(path, abortSignal) {
      return await env.readBinaryFile(fromPosixPath(path), abortSignal);
    },
    async writeFile(path, content, abortSignal) {
      return await env.writeFile(fromPosixPath(path), content, abortSignal);
    },
    async appendFile(path, content) {
      return await env.appendFile(fromPosixPath(path), content);
    },
    async fileInfo(path) {
      return mapInfoResult(await env.fileInfo(fromPosixPath(path)));
    },
    async listDir(path, abortSignal) {
      return mapListResult(await env.listDir(fromPosixPath(path), abortSignal));
    },
    async canonicalPath(path) {
      return mapPathResult(await env.canonicalPath(fromPosixPath(path)));
    },
    async exists(path) {
      return await env.exists(fromPosixPath(path));
    },
    async createDir(path, options) {
      return await env.createDir(fromPosixPath(path), options);
    },
    async remove(path, options) {
      return await env.remove(fromPosixPath(path), options);
    },
    async createTempDir(prefix) {
      return mapPathResult(await env.createTempDir(prefix));
    },
    async createTempFile(options) {
      return mapPathResult(await env.createTempFile(options));
    },
    async exec(command, options) {
      return await env.exec(command, options);
    },
    async cleanup() {
      await env.cleanup();
    },
  };
}

function mapPathResult(result: Result<string, FileError>): Result<string, FileError> {
  return result.ok ? { ok: true, value: toPosixPath(result.value) } : result;
}

function mapInfoResult(result: Result<FileInfo, FileError>): Result<FileInfo, FileError> {
  return result.ok
    ? {
        ok: true,
        value: {
          ...result.value,
          name: basenamePosix(toPosixPath(result.value.path)),
          path: toPosixPath(result.value.path),
        },
      }
    : result;
}

function mapListResult(result: Result<FileInfo[], FileError>): Result<FileInfo[], FileError> {
  return result.ok
    ? {
        ok: true,
        value: result.value.map((entry) => {
          const normalizedPath = toPosixPath(entry.path);
          return {
            ...entry,
            name: basenamePosix(normalizedPath),
            path: normalizedPath,
          };
        }),
      }
    : result;
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function fromPosixPath(path: string): string {
  return process.platform === "win32" ? path.replace(/\//g, "\\") : path;
}

function basenamePosix(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}
