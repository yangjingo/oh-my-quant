import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { isOptionalPrivateEvidence } from "./evidence-path.ts";

const root = resolve(import.meta.dir, "../..");
async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`;
    if (["node_modules", "dist"].includes(entry.name)) return [];
    if (["apps/desktop/runtime", "apps/desktop/.downloads"].includes(path)) return [];
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return files.flat().sort();
}
const docsFiles = await listFiles("docs");
const markdownFiles = docsFiles.filter((name) => name.endsWith(".md"));
const blogFiles = markdownFiles.filter((name) => /^docs\/blog\/[^/]+\.md$/.test(name));
const sourceGuides = [...await listFiles("src"), ...await listFiles("apps")].filter((name) => name.endsWith(".md"));
const current = [...markdownFiles, "README.md", "DESIGN.md", "site/README.md", ...sourceGuides];
const failures: string[] = [];
// The scoped product/architecture reading limit includes code and tables.
// Count Unicode characters, excluding whitespace, link destinations and anchors.
const conciseGuides = [
  "docs/prd.md",
  "docs/agent-runtime/architecture.md",
  "docs/agent-runtime/README.md",
  "docs/agent-runtime/configuration.md",
  "docs/quant-harness/uiux.md",
  "docs/quant-harness/community-tools.md",
  "docs/blog/08-research-workbench.md",
];
for (const file of conciseGuides) {
  const source = await readFile(resolve(root, file), "utf8");
  const readable = source
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<a id="[^"]+"><\/a>/g, "")
    .replace(/\s/g, "");
  const length = [...readable].length;
  const limit = file === "docs/prd.md" ? 3000 : 5000;
  console.log(`${file}: ${length}/${limit} readable characters`);
  if (length > limit) failures.push(`Product/architecture document exceeds ${limit} readable characters: ${file} (${length})`);
}
const rootMarkdown = markdownFiles.filter(file => dirname(file) === "docs");
const rootDocuments = new Set(["docs/README.md", "docs/prd.md", "docs/ci-release.md"]);
if (rootMarkdown.length !== rootDocuments.size || rootMarkdown.some(file => !rootDocuments.has(file))) {
  failures.push("The docs root contains README.md, prd.md and ci-release.md; classify other documents by responsibility.");
}
const documentDirectories = new Set(["agent-runtime", "quant-harness", "evaluation", "blog"]);
for (const file of markdownFiles) {
  if (!rootDocuments.has(file) && !documentDirectories.has(file.split("/")[1])) {
    failures.push(`Unclassified document directory: ${file}`);
  }
}
for (const directory of ["agent-runtime", "quant-harness", "evaluation"]) {
  const index = `docs/${directory}/README.md`;
  if (!docsFiles.includes(index)) { failures.push(`Missing design directory index: ${index}`); continue; }
  const source = await readFile(resolve(root, index), "utf8");
  const targets = new Set([...source.matchAll(/\]\((\.[^\s)#?]+)(?:[?#][^\s)]*)?\)/g)]
    .map(match => resolve(root, dirname(index), decodeURIComponent(match[1]))));
  for (const file of markdownFiles.filter(file => file.startsWith(`docs/${directory}/`) && file !== index)) {
    if (!targets.has(resolve(root, file))) failures.push(`Document missing from ${directory} index: ${file}`);
  }
}
const retiredTopics = new Set([
  "desktop", "research-workspace", "quant-uiux",
  "research-state", "research-tasks", "session-dependencies", "chart-image-input",
  "skill-installation", "skill-readiness", "supplied-evidence-skills",
  "quant-factor-methods", "builtin-tool-registry", "research-data-contract", "tui-table-chart-render",
  "pi-agent-loop-harness", "model-oauth", "pi-config-import", "model-performance", "doctor-design-and-hints",
].map(name => `${name}.md`));
if (docsFiles.some(file => file.includes("/archive/") || basename(file) === "design-decisions.md" || retiredTopics.has(basename(file)))) {
  failures.push("Retired archive, decision ledger or merged topic reintroduced; update current contracts and blog reflections instead.");
}
const explicitAnchors = new Map<string, string[]>();
for (const file of current) {
  const path = resolve(root, file);
  const source = await readFile(path, "utf8");
  const anchors = [...source.matchAll(/<a id="([^"]+)"><\/a>/g)].map((match) => match[1]);
  if (anchors.length !== new Set(anchors).size) failures.push(`Duplicate explicit anchors: ${file}`);
  // Include rendered heading IDs as well as stable migration anchors. GitHub/Bun
  // headings may coexist with explicit anchors in merged documents.
  const prose = source.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, "");
  const counts = new Map<string, number>();
  const headingIds = [...prose.matchAll(/^#{1,6} (.+)\r?$/gm)].map((match) => {
    const slug = match[1].trim().toLowerCase().replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/\s/g, "-");
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    return count ? `${slug}-${count}` : slug;
  });
  explicitAnchors.set(path, [...new Set([...anchors, ...headingIds])]);
}
let links = 0;
let checkedExplicitAnchors = 0;
let unavailablePrivateEvidence = 0;
for (const file of current) {
  const source = await readFile(resolve(root, file), "utf8");
  const prose = source.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, "");
  for (const match of prose.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1];
    if (/^(?:[a-z]+:|\/\/)/i.test(href)) continue;
    const [relative, fragment] = href.split("#");
    const path = relative.split("?")[0];
    const target = path ? resolve(dirname(resolve(root, file)), decodeURIComponent(path)) : resolve(root, file);
    if (path) {
      links++;
      try { await stat(target); }
      catch {
        if (isOptionalPrivateEvidence(root, target)) unavailablePrivateEvidence++;
        else failures.push(`${file}: ${href}`);
      }
    }
    const anchors = explicitAnchors.get(target);
    if (anchors && fragment) {
      checkedExplicitAnchors++;
      if (!anchors.includes(decodeURIComponent(fragment))) failures.push(`Missing explicit anchor: ${file}: ${href}`);
    }
  }
}
const chapters = blogFiles.filter((file) => /\/\d{2}-/.test(file));
if (chapters.length !== 11) failures.push(`Expected eleven chapters, found ${chapters.length}`);
const svgs = (await readdir(resolve(import.meta.dir, "images"))).filter((name) => name.endsWith(".svg"));
if (svgs.length !== chapters.length) failures.push(`Expected one diagram per chapter, found ${svgs.length}`);
for (const chapter of chapters) {
  const source = await readFile(resolve(root, chapter), "utf8");
  if ((source.match(/!\[[^\]]+\]\(\.\/images\//g) ?? []).length !== 1) failures.push(`Expected one captioned diagram: ${chapter}`);
  if (!source.includes("## 实现索引")) failures.push(`Missing evidence index: ${chapter}`);
  const headings = [...source.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim());
  if (headings.length !== 5 || headings[4] !== "实现索引") {
    failures.push(`Expected four body sections followed by the evidence index: ${chapter}`);
  }
  if (headings.some((heading) => /^(?:问题|冲突|解决方案|结果与反思)：/.test(heading))) failures.push(`Writing-framework label exposed in heading: ${chapter}`);
  if (!/^Agent Engineering[^\n]*初稿 \d{4}-\d{2}-\d{2} · 修订 \d{4}-\d{2}-\d{2}/m.test(source)) failures.push(`Missing publication/revision dates: ${chapter}`);
}
for (const name of svgs) {
  const source = await readFile(resolve(import.meta.dir, "images", name), "utf8");
  if (!source.includes("<title") || !source.includes("<desc")) failures.push(`Missing SVG accessibility text: ${name}`);
  if (/<script|(?:href|src)=["']https?:/i.test(source)) failures.push(`External resource or script in SVG: ${name}`);
}
const html = await readFile(resolve(import.meta.dir, "index.html"), "utf8");
if ((html.match(/<article id="chapter-/g) ?? []).length !== chapters.length) failures.push("HTML chapter count differs from Markdown");
if ((html.match(/src="data:image\/svg\+xml;base64,/g) ?? []).length !== chapters.length) failures.push("HTML does not embed all chapter SVGs");
if (/<script|(?:src|url\()\s*[="']*https?:/i.test(html)) failures.push("HTML contains an external runtime resource");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
if (ids.length !== new Set(ids).size) failures.push("Duplicate HTML IDs");
for (const match of html.matchAll(/href="#([^"]+)"/g)) if (!ids.includes(match[1])) failures.push(`Missing HTML anchor: ${match[1]}`);
for (const match of html.matchAll(/href="([^"#]+\.md)(#[^"]*)?"/g)) {
  if (/^(?:[a-z]+:|\/\/)/i.test(match[1])) continue;
  const target = resolve(import.meta.dir, decodeURIComponent(match[1]));
  links++;
  try { await stat(target); } catch { failures.push(`Offline blog: ${match[1]}`); }
  if (match[2] && !explicitAnchors.get(target)?.includes(decodeURIComponent(match[2].slice(1)))) {
    failures.push(`Missing offline blog document anchor: ${match[0]}`);
  }
}
const websiteHome = await readFile(resolve(root, "site/templates/home.html"), "utf8");
for (const match of websiteHome.matchAll(/https:\/\/github\.com\/yangjingo\/oh-my-quant\/blob\/main\/(docs\/[^"#?]+\.md)/g)) {
  links++;
  try { await stat(resolve(root, match[1])); } catch { failures.push(`Website repository link: ${match[1]}`); }
}
const nav = await readFile(resolve(root, "docs/README.md"), "utf8");
const slides = await readFile(resolve(root, "docs/slides.html"), "utf8");
const slideIds = [...slides.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
if (slideIds.length !== new Set(slideIds).size) failures.push("Duplicate presentation IDs");
if ((slides.match(/<section class="slide"/g) ?? []).length !== 12) failures.push("Expected twelve presentation slides");
for (const match of slides.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
  const href = match[1];
  if (/^(?:[a-z]+:|\/\/)/i.test(href)) continue;
  const [path, fragment] = href.split("#");
  if (!path) {
    if (fragment && !slideIds.includes(fragment)) failures.push(`Missing presentation anchor: ${href}`);
    continue;
  }
  links++;
  try { await stat(resolve(root, "docs", decodeURIComponent(path))); }
  catch { failures.push(`docs/slides.html: ${href}`); }
  if (fragment && path.endsWith(".md")) {
    checkedExplicitAnchors++;
    if (!explicitAnchors.get(resolve(root, "docs", decodeURIComponent(path)))?.includes(decodeURIComponent(fragment))) {
      failures.push(`Missing presentation document anchor: ${href}`);
    }
  }
}
const navTargets = new Set<string>();
for (const catalog of ["docs/README.md"]) {
  const content = await readFile(resolve(root, catalog), "utf8");
  for (const match of content.matchAll(/\]\((\.[^\s)#?]+)(?:[?#][^\s)]*)?\)/g)) {
    navTargets.add(resolve(root, dirname(catalog), decodeURIComponent(match[1])));
  }
}
for (const file of docsFiles) {
  if (!navTargets.has(resolve(root, file))) failures.push(`File missing from docs navigation: ${file}`);
}
console.log(`Checked ${current.length} Markdown documents, ${docsFiles.length} catalogued files, ${links} local link targets, ${checkedExplicitAnchors} explicit anchor references, ${svgs.length} SVGs, the offline blog, and presentation links.`);
if (unavailablePrivateEvidence) console.log(`${unavailablePrivateEvidence} private output evidence links are unavailable locally; they are not required clone artifacts and were not revalidated.`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("Documentation checks passed. This is not runtime or external-service validation.");
