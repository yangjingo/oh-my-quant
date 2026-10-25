import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

interface BoundaryRule {
  id: string;
  from: string[];
  blockedTo: string[];
  reason: string;
}

interface Violation {
  key: string;
  rule: string;
  from: string;
  to: string;
  specifier: string;
  reason: string;
}

const ROOT = resolve(import.meta.dir, "../..");
const SRC_ROOT = join(ROOT, "src");
const BASELINE_PATH = join(ROOT, "tests", "architecture", "architecture-boundary-baseline.json");

const RULES: BoundaryRule[] = [
  {
    id: "agent-does-not-compose-application",
    from: ["agent"],
    blockedTo: ["runtime", "tools", "cli", "tui"],
    reason: "The agent consumes injected session ports; default tools and application settings are assembled in runtime.",
  },
  {
    id: "runtime-does-not-depend-on-ui",
    from: ["runtime"],
    blockedTo: ["cli", "tui"],
    reason: "Runtime services consume shared contracts; CLI dispatch and TUI rendering depend on the services, never the reverse.",
  },
  {
    id: "performance-is-private-and-transient",
    from: ["performance"],
    blockedTo: ["agent", "app", "artifact", "cli", "execution", "extensions", "runtime", "skill", "source", "storage", "tools", "tui", "research"],
    reason: "Account performance uses an explicit read-only history adapter and pure calculations, never credential discovery, persistence or Agent/public report output.",
  },
  {
    id: "private-account-data-stays-out-of-research",
    from: ["agent", "artifact", "market", "quant", "research", "skill", "source", "storage", "tools", "tui", "types", "execution"],
    blockedTo: ["performance"],
    reason: "Private account performance may only be assembled by an explicit application host; research results and public market data cannot consume it.",
  },
  {
    id: "alpha-consumes-explicit-inputs",
    from: ["alpha"],
    blockedTo: ["agent", "app", "artifact", "cli", "execution", "extensions", "runtime", "skill", "source", "storage", "tools", "tui", "research"],
    reason: "Alpha engines receive fixed data and options; fetching, persistence, UI and live execution belong to other adapters.",
  },
  {
    id: "lower-layers-do-not-run-alpha",
    from: ["types", "quant", "market", "source", "storage", "tui", "execution"],
    blockedTo: ["alpha"],
    reason: "External alpha engines are orchestrated above shared contracts, pure calculations, persistence and rendering.",
  },
  {
    id: "execution-is-an-explicit-port",
    from: ["execution"],
    blockedTo: ["agent", "app", "artifact", "cli", "extensions", "market", "quant", "runtime", "skill", "source", "storage", "tools", "tui", "research"],
    reason: "Execution contracts use injected adapters and must not discover credentials, persist private state or call research/UI modules.",
  },
  {
    id: "execution-stays-out-of-research-and-public-data",
    from: ["agent", "artifact", "market", "quant", "research", "skill", "source", "storage", "tui", "types"],
    blockedTo: ["execution"],
    reason: "Private execution belongs to explicit application adapters, not research prompts, reports, public data or storage.",
  },
  {
    id: "extension-host-is-independent",
    from: ["extensions"],
    blockedTo: ["app", "cli", "quant", "runtime", "skill", "source", "storage", "tools", "tui", "research"],
    reason: "The extension host owns lifecycle and public contracts; application bindings stay in runtime.",
  },
  {
    id: "research-is-independent-evidence",
    from: ["research"],
    blockedTo: ["agent", "app", "artifact", "cli", "runtime", "skill", "source", "tools", "tui"],
    reason: "Research consumes journal snapshots and archived observations, not UI, live providers or the Agent loop.",
  },
  {
    id: "lower-layers-do-not-own-research",
    from: ["types", "storage", "quant", "source", "market", "tui"],
    blockedTo: ["research"],
    reason: "Research orchestration stays above shared types, persistence and pure calculations; UI consumes runtime projections.",
  },
  {
    id: "types-are-shared-contracts",
    from: ["types"],
    blockedTo: ["agent", "app", "artifact", "cli", "quant", "runtime", "skill", "source", "storage", "tools", "tui"],
    reason: "src/types must stay provider/UI/runtime independent.",
  },
  {
    id: "storage-owns-persistence-only",
    from: ["storage"],
    blockedTo: ["agent", "app", "artifact", "cli", "quant", "runtime", "skill", "source", "tools", "tui"],
    reason: "storage should expose persistence APIs without depending on higher-level modules.",
  },
  {
    id: "quant-core-is-pure",
    from: ["quant"],
    blockedTo: ["agent", "app", "artifact", "cli", "runtime", "skill", "source", "storage", "tools", "tui"],
    reason: "quant core should stay pure and receive data/persistence through adapters.",
  },
  {
    id: "source-provider-boundary",
    from: ["source"],
    blockedTo: ["agent", "app", "artifact", "cli", "quant", "runtime", "skill", "storage", "tools", "tui"],
    reason: "source providers should not depend on UI, tools, agent, storage, or quant workflows.",
  },
  {
    id: "market-normalization-is-pure",
    from: ["market"],
    blockedTo: ["agent", "app", "artifact", "cli", "quant", "runtime", "skill", "source", "storage", "tools", "tui"],
    reason: "Market symbols, dates and bars should not depend on IO or orchestration.",
  },
  {
    id: "tui-is-render-adapter",
    from: ["tui"],
    blockedTo: ["agent", "cli", "quant", "skill", "source", "storage", "tools"],
    reason: "tui should consume runtime view models instead of calling business modules directly.",
  },
  {
    id: "skill-does-not-depend-on-cli",
    from: ["skill"],
    blockedTo: ["cli", "tui", "tools"],
    reason: "skill commands should use shared contracts, not CLI/TUI implementations.",
  },
  {
    id: "tools-do-not-depend-on-ui",
    from: ["tools"],
    blockedTo: ["app", "cli", "tui"],
    reason: "tools should remain agent adapters and not depend on UI or CLI layers.",
  },
  {
    id: "cli-does-not-depend-on-tui",
    from: ["cli"],
    blockedTo: ["app", "tui"],
    reason: "slash command handlers should not depend on the interactive renderer.",
  },
];

const WRITE_BASELINE = process.argv.includes("--write-baseline");

function main(): void {
  assertKernelDependencies();
  const violations = findViolations();
  const baseline = loadBaseline();
  if (WRITE_BASELINE) {
    writeBaseline(violations);
    console.log(`Wrote ${violations.length} architecture baseline entries to ${relative(ROOT, BASELINE_PATH)}.`);
    return;
  }

  const currentKeys = new Set(violations.map((entry) => entry.key));
  const baselineKeys = new Set(baseline.map((entry) => entry.key));
  const newViolations = violations.filter((entry) => !baselineKeys.has(entry.key));
  const staleBaseline = baseline.filter((entry) => !currentKeys.has(entry.key));

  if (newViolations.length === 0 && staleBaseline.length === 0) {
    console.log(`Architecture boundary check passed (${violations.length} baseline violations).`);
    return;
  }

  if (newViolations.length > 0) {
    console.error(`New architecture boundary violations (${newViolations.length}):`);
    printViolations(newViolations);
  }
  if (staleBaseline.length > 0) {
    console.error(`Stale architecture baseline entries (${staleBaseline.length}); remove them from ${relative(ROOT, BASELINE_PATH)}:`);
    printViolations(staleBaseline);
  }
  process.exitCode = 1;
}

function assertKernelDependencies(): void {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const core = manifest.dependencies?.["@earendil-works/pi-agent-core"];
  const ai = manifest.dependencies?.["@earendil-works/pi-ai"];
  if (typeof core !== "string" || !/^\d+\.\d+\.\d+$/.test(core) || core !== ai) {
    throw new Error("pi-agent-core and pi-ai must pin the same exact release.");
  }
  const config = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8"));
  const paths = Object.keys(config.compilerOptions?.paths ?? {});
  if (paths.some((path) => path.startsWith("@earendil-works/pi-"))) {
    throw new Error("Do not shadow the installed pi kernel with a local TypeScript path alias.");
  }
}

function findViolations(): Violation[] {
  const appsRoot = join(ROOT, "apps");
  const files = [...listTsFiles(SRC_ROOT), ...(existsSync(appsRoot) ? listTsFiles(appsRoot) : [])];
  const violations: Violation[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const fromModule = moduleOf(file);
    if (!fromModule) continue;
    const implementationSpecifiers = new Set(importSpecifiers(source.replace(/\b(?:import|export)\s+type\b[^;]+;/gms, "")));
    violations.push(...findOhquantPathViolations(file, source, fromModule));
    for (const specifier of importSpecifiers(source)) {
      const isCore = specifier === "@earendil-works/pi-agent-core" && implementationSpecifiers.has(specifier);
      const isProvider = /^@earendil-works\/pi-ai\/(api|providers)\//.test(specifier);
      const expected = isCore ? "src/agent/src/kernel/loop.ts" : "src/agent/src/kernel/llm.ts";
      if ((isCore || isProvider) && toProjectPath(file) !== expected) {
        const rule = "agent-kernel-owns-upstream-runtime";
        violations.push({
          rule, from: toProjectPath(file), to: expected, specifier,
          reason: "Route upstream loop/provider implementations through the agent kernel boundary.",
          key: [rule, toProjectPath(file), expected, specifier].join("|"),
        });
      }
      const target = resolveLocalImport(file, specifier);
      const targetModule = target ? moduleOf(target) : null;
      const boundary = (rule: string, reason: string) => {
        const from = toProjectPath(file), to = target ? toProjectPath(target) : specifier;
        violations.push({ rule, from, to, specifier, reason, key: [rule, from, to, specifier].join("|") });
      };
      if (target && toProjectPath(target).startsWith("apps/") && toProjectPath(file).startsWith("src/")
        && !["src/app.ts", "src/index.ts"].includes(toProjectPath(file))) {
        boundary("shared-layers-do-not-import-apps", "Only existing entry composition bridges may load apps; shared services and contracts must remain UI-independent.");
      }
      // Web bootstrap selects its explicit demo adapter; web:check verifies that
      // the normal production bundle excludes it. Other consumers stay blocked.
      const webDemoEntry = toProjectPath(file) === "apps/web/src/main.tsx"
        && target && toProjectPath(target) === "apps/web/dev/demo-client.ts";
      if (target && toProjectPath(target).includes("/dev/") && !webDemoEntry) {
        boundary("production-does-not-import-dev", "Module-local development entrypoints are manual consumers; production modules must not import them.");
      }
      if (target && toProjectPath(target).startsWith("src/runtime/evaluation/")
        && !toProjectPath(file).startsWith("src/runtime/evaluation/")) {
        boundary("evaluation-is-not-runtime-dependency", "Evaluation runners and synthetic cases are optional consumers; production services must not import them.");
      }
      if (toProjectPath(file).startsWith("src/runtime/evidence/") && targetModule === "runtime"
        && target && !toProjectPath(target).startsWith("src/runtime/evidence/")) {
        boundary("answer-evidence-is-independent", "Answer checks consume supplied research evidence; host services and evaluation fixtures must not become dependencies.");
      }
      if (specifier === "bun:test" || target && /(?:^tests\/|\/(?:test|tests)\/|\.(?:test|spec)\.[cm]?[jt]sx?$)/.test(toProjectPath(target))) {
        boundary("production-does-not-import-tests", "Production modules cannot depend on test runners, tests or test fixtures.");
      }
      if (fromModule === "performance" && (target
        ? !["performance", "quant", "types"].includes(targetModule ?? "")
        : specifier !== "node:util")) {
        boundary("performance-consumes-explicit-inputs", "Keep file/provider IO in host adapters; performance only imports its own code, quant, types and node:util.");
      }
      if (fromModule === "skill" && (target
        ? !["skill", "types"].includes(targetModule ?? "") || toProjectPath(target) === "src/types/commands.ts"
        : !specifier.startsWith("node:"))) {
        boundary("skill-is-independent-of-host", "Skill domain services accept explicit paths and process ports; commands, discovery, settings and providers belong to the host.");
      }
      if (fromModule === "quant" && (!target || !["quant", "market", "types"].includes(targetModule ?? "")
        || toProjectPath(target) === "src/types/commands.ts")) {
        boundary("quant-consumes-explicit-data", "Quant calculations only import their own code, market normalization and shared data contracts; IO and workflows belong to hosts.");
      }
      if (targetModule && targetModule !== fromModule && ["performance", "alpha", "execution", "extensions", "skill", "quant"].includes(targetModule)
        && toProjectPath(target!) !== `src/${targetModule}/index.ts`) {
        boundary("feature-public-entry", "Feature consumers must use the module index.ts; internal files may change or be removed independently.");
      }
      if (!target) continue;
      const toModule = moduleOf(target);
      if (!toModule || toModule === fromModule) continue;
      if (toProjectPath(file) === "src/agent/src/session.ts" && ["storage", "tools", "source", "tui"].includes(toModule)) {
        const rule = "session-consumes-injected-ports";
        violations.push({ rule, from: toProjectPath(file), to: toProjectPath(target), specifier,
          reason: "Bind concrete IO and builtin tools in session-dependencies, not the session facade.",
          key: [rule, toProjectPath(file), toProjectPath(target), specifier].join("|"),
        });
      }
      for (const rule of RULES) {
        if (!rule.from.includes(fromModule) || !rule.blockedTo.includes(toModule)) continue;
        const violation = {
          rule: rule.id,
          from: toProjectPath(file),
          to: toProjectPath(target),
          specifier,
          reason: rule.reason,
        };
        violations.push({
          ...violation,
          key: [violation.rule, violation.from, violation.to, violation.specifier].join("|"),
        });
      }
    }
  }
  return violations.sort(compareViolation);
}

function findOhquantPathViolations(file: string, source: string, fromModule: string): Violation[] {
  if (fromModule === "storage") return [];
  const violations: Violation[] = [];
  const lines = source.split("\n");
  lines.forEach((lineText, index) => {
    if (!/(^|[^.\w])(?:join|resolve)\s*\(/.test(lineText) || !lineText.includes(".ohquant")) return;
    const pathLiteral = lineText.match(/["'](\.ohquant[^"']*)["']/)?.[1] ?? ".ohquant";
    const violation = {
      rule: "storage-owns-ohquant-paths",
      from: `${toProjectPath(file)}:${index + 1}`,
      to: ".ohquant",
      specifier: pathLiteral,
      reason: "Only storage should construct .ohquant filesystem paths.",
    };
    violations.push({
      ...violation,
      key: [violation.rule, violation.from, violation.to, violation.specifier].join("|"),
    });
  });
  return violations;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...listTsFiles(full));
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/.test(entry)) continue;
    const projectPath = toProjectPath(full);
    if (projectPath.endsWith(".test.ts")) continue;
    if (projectPath.includes("/test/") || projectPath.includes("/tests/")) continue;
    if (projectPath.includes("/dev/")) continue;
    out.push(full);
  }
  return out;
}

function importSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const staticImportRe = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gms;
  const dynamicImportRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gms;
  for (const match of source.matchAll(staticImportRe)) specifiers.add(match[1]!);
  for (const match of source.matchAll(dynamicImportRe)) specifiers.add(match[1]!);
  return [...specifiers];
}

function resolveLocalImport(fromFile: string, rawSpecifier: string): string | null {
  if (!rawSpecifier.startsWith(".")) return null;
  const specifier = rawSpecifier.split("?")[0]!;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    ...(/\.[cm]?js$/.test(base) ? [base.replace(/\.[cm]?js$/, ".ts")] : []),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function moduleOf(file: string): string | null {
  const rel = toProjectPath(file);
  if (rel.startsWith("apps/")) return rel.split("/")[1] === "tui" ? "tui" : `apps/${rel.split("/")[1]}`;
  if (!rel.startsWith("src/")) return null;
  const rest = rel.slice("src/".length);
  const first = rest.split("/")[0]!;
  if (first.endsWith(".ts")) return "app";
  return first;
}

function loadBaseline(): Violation[] {
  if (!existsSync(BASELINE_PATH)) return [];
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as { violations?: Violation[] };
  return [...(parsed.violations ?? [])].sort(compareViolation);
}

function writeBaseline(violations: Violation[]): void {
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ violations }, null, 2)}\n`,
    "utf8",
  );
}

function printViolations(violations: Violation[]): void {
  for (const violation of violations.slice(0, 50)) {
    console.error(`- ${violation.rule}: ${violation.from} -> ${violation.to} (${violation.specifier})`);
  }
  if (violations.length > 50) console.error(`... ${violations.length - 50} more`);
}

function compareViolation(a: Violation, b: Violation): number {
  return a.key.localeCompare(b.key);
}

function toProjectPath(file: string): string {
  return relative(ROOT, file).replace(/\\/g, "/");
}


main();
