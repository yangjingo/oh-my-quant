/**
 * Comparison artifact storage under .ohquant/benchmark/comparisons/.
 * These are derived results (return curves + risk metrics), not portfolio cache.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitFileEvent } from "./fs-events.ts";
import { OHQUANT_DIR, ensureDirs } from "./dirs.ts";
import type { GroupComparisonResult } from "../../quant/group-comparison.ts";

export interface ComparisonArtifact {
  id: string;
  createdAt: string;
  groups: GroupComparisonResult[];
}

const COMPARISONS_DIR = "benchmark/comparisons";

function comparisonsDir(): string {
  return join(process.env.OHQUANT_DIR || OHQUANT_DIR, COMPARISONS_DIR);
}

export function ensureComparisonsDir(): void {
  const dir = comparisonsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function saveComparison(artifact: ComparisonArtifact): void {
  ensureDirs();
  ensureComparisonsDir();
  const path = join(comparisonsDir(), `${artifact.id}.json`);
  const text = JSON.stringify(artifact, null, 2);
  writeFileSync(path, text, "utf-8");
  emitFileEvent({ operation: "WRITE", path, bytes: text.length, detail: "comparison artifact" });
}

export function loadComparison(id: string): ComparisonArtifact | null {
  const path = join(comparisonsDir(), `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf-8");
    emitFileEvent({ operation: "READ", path, bytes: text.length, detail: "comparison artifact" });
    return JSON.parse(text) as ComparisonArtifact;
  } catch {
    return null;
  }
}

export function listComparisons(): { id: string; createdAt: string }[] {
  const dir = comparisonsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const path = join(dir, f);
      try {
        const text = readFileSync(path, "utf-8");
        const raw = JSON.parse(text) as ComparisonArtifact;
        return { id: raw.id, createdAt: raw.createdAt };
      } catch {
        return { id: f.replace(".json", ""), createdAt: "" };
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteComparison(id: string): boolean {
  const path = join(comparisonsDir(), `${id}.json`);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  emitFileEvent({ operation: "DELETE", path, bytes: 0, detail: "comparison artifact" });
  return true;
}

export function generateComparisonId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  return `cmp-${date}-${time}`;
}
