import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { generateInsights } from "../src/quant/insight-generator.ts";

const ROOT = resolve(import.meta.dir, "..");
const entries = generateInsights();

const outDir = resolve(ROOT, ".ohquant");
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, "insights.json");
writeFileSync(out, JSON.stringify(entries, null, 2), "utf-8");
console.log(`Wrote ${entries.length} insights to ${out}`);
