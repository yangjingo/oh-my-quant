/**
 * Shared insight generation: parses notes/*.md → InsightEntry[].
 * Used by both scripts/generate-insights.ts (CLI) and insight.ts (auto-regenerate).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

export interface InsightEntry {
  quote: string;
  en: string;
  author: string;
  title: string;
  principle: string;
  wisdom: string;
  source: string;
  keywords: string[];
}

const FUNDER_PATH = resolve(ROOT, "notes/quant/funder.md");
const NOTES_PATH = resolve(ROOT, "notes/quant/notes.md");

export function getNotePaths(): string[] {
  return [FUNDER_PATH, NOTES_PATH];
}

function readNotes(relPath: string): string {
  return readFileSync(relPath, "utf-8");
}

function deriveKeywords(input: string): string[] {
  const normalized = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  return [...new Set(normalized)].slice(0, 16);
}

function normalize(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function parseFunder(content: string): InsightEntry[] {
  const entries: InsightEntry[] = [];
  const sections = content.split(/^## /m);
  for (const sec of sections) {
    const nl = sec.indexOf("\n");
    if (nl === -1) continue;
    const author = sec.slice(0, nl).trim();
    const skip = new Set(["目录", "参考资料", "对话/访谈栏目", "量化 UP 主 / 创作者", "---"]);
    if (!author || skip.has(author) || author.startsWith("#")) continue;
    if (!sec.includes("### 核心投资原则")) continue;

    const idx = sec.indexOf("### 核心投资原则");
    const raw = sec.slice(idx).split("\n").slice(1);

    for (const line of raw) {
      if (/^#{1,4}\s/.test(line)) break;
      const m = line.match(/^\d+\.\s+\*\*(.+?)\*\*\s*[—–-]\s*(.+)/);
      if (!m) continue;
      const term = m[1].trim();
      const desc = m[2].trim().replace(/[（(][^)）]*[）)]\s*$/, "").replace(/。$/, "");
      const enM = term.match(/[（(]([^)）]+)[）)]/);
      const en = enM ? enM[1].trim() : term;
      const principle = normalize(m[2]);
      entries.push({
        quote: desc,
        en,
        author,
        title: `${author} · ${normalize(term)}`,
        principle,
        wisdom: `参考 ${author} 的核心投资原则。`,
        source: `notes/quant/funder.md · ${author}`,
        keywords: deriveKeywords(`${author} ${term} ${desc}`),
      });
    }
  }
  return entries;
}

function parseNotes(content: string): InsightEntry[] {
  const entries: InsightEntry[] = [];

  // P-rules: **P1 — title** body *对应智慧：...*
  const pRegex = /\*\*(P\d+)\s*—\s*([^*]+)\*\*\s*([\s\S]*?)\*对应智慧：([^*]+)\*/g;
  for (const match of content.matchAll(pRegex)) {
    const [, id, title, body, wisdom] = match;
    const principle = normalize(body);
    const titleClean = normalize(title);
    entries.push({
      quote: principle,
      en: titleClean,
      author: "WhyJ",
      title: `${id} ${titleClean}`,
      principle,
      wisdom: normalize(wisdom),
      source: `notes/quant/notes.md · ${id}`,
      keywords: deriveKeywords(`${titleClean} ${principle} ${wisdom}`),
    });
  }

  // 大师法则 table: | # | **name** | rule | quote | P* |
  const lines = content.split("\n");
  let inTable = false;
  for (const line of lines) {
    if (line.includes("大师法则")) { inTable = true; continue; }
    if (!inTable) continue;
    const m = line.match(/^\|\s*\d+\s*\|\s*\*\*(.+?)\*\*\s*\|/);
    if (!m) continue;
    const author = m[1].trim();
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    const cn = cells[3] ?? "";
    const rule = cells[2] ?? "";
    if (!cn) continue;
    entries.push({
      quote: cn,
      en: rule,
      author,
      title: `${author} · ${rule}`,
      principle: cn,
      wisdom: `来自 ${author} 的行动规则。`,
      source: "notes/quant/notes.md · 大师法则",
      keywords: deriveKeywords(`${author} ${rule} ${cn}`),
    });
  }
  return entries;
}

export function generateInsights(): InsightEntry[] {
  const entries: InsightEntry[] = [];
  if (existsSync(FUNDER_PATH)) {
    entries.push(...parseFunder(readNotes(FUNDER_PATH)));
  }
  if (existsSync(NOTES_PATH)) {
    entries.push(...parseNotes(readNotes(NOTES_PATH)));
  }

  // Deduplicate by quote prefix
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = e.quote.slice(0, 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
