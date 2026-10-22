// Publication adapter for the approved, self-contained HTML manuscript.
// Run from the repository with its existing linkedom dependency installed.
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseHTML } from "linkedom";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = "docs/blog/agentic/agent-desktop-lifecycle.html";
const route = "/blog/agent-desktop-lifecycle/";
const directory = path.join(root, "site/content", route);
const bytes = await readFile(path.join(root, source));
const sha = data => createHash("sha256").update(data).digest("hex");
const files = new Map();
const extensions = { "image/png": "png", "image/svg+xml": "svg", "font/woff2": "woff2", "font/ttf": "ttf", "font/woff": "woff" };
const html = bytes.toString("utf8").replace(/data:([A-Za-z0-9+./-]+);base64,([A-Za-z0-9+/=]+)/g, (_, mime, encoded) => {
  if (!extensions[mime]) throw new Error(`Unreviewed embedded asset: ${mime}`);
  const data = Buffer.from(encoded, "base64");
  const file = `assets/${sha(data).slice(0, 20)}.${extensions[mime]}`;
  files.set(file, data);
  return `${route}${file}`;
});
const { document } = parseHTML(html);
if (document.querySelectorAll("[style]").length) throw new Error("Review inline styles against the production CSP");
document.documentElement.removeAttribute("data-offline-export");
document.querySelector('meta[name="robots"]')?.remove();
document.querySelector(".draft-label")?.remove();
const canonical = document.createElement("link");
canonical.rel = "canonical";
canonical.href = `https://oh-my-quant.vercel.app${route}`;
document.head.append(canonical);
const share = document.querySelector("#share-article");
share.setAttribute("aria-label", "分享文章");
share.title = "分享或复制文章链接";

// Existing reading styles include the compact table controls. Reuse their
// implementation and Lucide symbols rather than inventing another UI library.
const reference = parseHTML(await readFile(path.join(root, "site/content/blog/vibe-repo-ops/index.html"), "utf8")).document;
const icons = document.querySelector("#blog-control-icons").content;
for (const name of ["settings-2", "columns-2", "maximize-2"]) {
  icons.append(reference.querySelector(`[data-icon="${name}"]`).cloneNode(true));
}
const icon = name => icons.querySelector(`[data-icon="${name}"]`).outerHTML;
const titles = ["启动方式与状态", "测试职责与位置"];
const tables = [...document.querySelectorAll("#article table")];
if (tables.length !== titles.length) throw new Error("Review changed table titles");
tables.forEach((table, index) => {
  const id = index + 1;
  table.id = `table-data-${id}`;
  const component = document.createElement("section");
  component.className = "interactive-table";
  component.setAttribute("aria-label", titles[index]);
  component.innerHTML = `<div class="component-header"><p class="component-title">表 ${id} · ${titles[index]}</p><div class="table-tools" hidden><button class="quiet-icon" type="button" data-settings aria-label="筛选与显示列" title="筛选与显示列" aria-expanded="false" aria-controls="table-settings-${id}">${icon("settings-2")}</button><button class="quiet-icon" type="button" data-select aria-label="选择项目对比" title="选择项目对比" aria-pressed="false">${icon("columns-2")}</button><button class="quiet-icon" type="button" data-expand aria-label="展开阅读" title="展开阅读">${icon("maximize-2")}</button></div></div><div class="table-settings" id="table-settings-${id}" hidden><label class="table-search">搜索全表<input type="search" autocomplete="off" aria-controls="table-data-${id}"></label><div class="column-options"></div><button class="text-action" type="button" data-reset>重置筛选与列</button></div><div class="table-state" hidden><output aria-live="polite"></output><button class="text-action" type="button" data-compare hidden>对比所选</button><button class="quiet-icon" type="button" data-cancel aria-label="退出对比" title="退出对比" hidden>${icon("x")}</button></div><div class="table-scroll" tabindex="0" role="region" aria-label="${titles[index]}，可横向滚动"></div><p class="table-empty" hidden>没有匹配的行，请修改关键词或重置。</p>`;
  table.replaceWith(component);
  component.querySelector(".table-scroll").append(table);
});
const styles = [...document.querySelectorAll("style")];
files.set("assets/article.css", Buffer.from(styles.map(e => e.textContent).join("\n")));
styles.forEach(e => e.remove());
const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet"; stylesheet.href = `${route}assets/article.css`;
document.head.append(stylesheet);
const scripts = [...document.querySelectorAll('script:not([type="application/json"])')];
files.set("assets/article.js", Buffer.from(scripts.map(e => e.textContent).join("\n")));
scripts.forEach(e => e.remove());
files.set("assets/tables.js", Buffer.from(`(() => {\nfunction blogIcon(name) { return document.querySelector('#blog-control-icons').content.querySelector('[data-icon="' + name + '"]').cloneNode(true); }\n${await readFile(path.join(root, "site/previews/vibe-repo-ops/tables.js"), "utf8")}\n})();\n`));
for (const name of ["article", "tables"]) {
  const script = document.createElement("script"); script.src = `${route}assets/${name}.js`; script.defer = true;
  document.body.append(script);
}
// Preserve the bundled font/icon licenses while avoiding an inline script tag.
const license = document.querySelector("#bundled-asset-licenses");
for (const [name, text] of Object.entries(JSON.parse(license.textContent))) {
  if (!/^assets\/[\w./-]+\.txt$/.test(name) || name.includes("..")) throw new Error("Unexpected license path");
  files.set(name, Buffer.from(text.replaceAll("\r\n", "\n")));
}
license.remove();
files.set("index.html", Buffer.from(document.toString()));
for (const [name, data] of files) {
  if (/\.(?:html|css|js|svg|txt)$/.test(name)) files.set(name, Buffer.from(data.toString("utf8").replaceAll("\r\n", "\n")));
}
// Only this generator's fixed package may be replaced.
if (path.resolve(directory) !== path.join(root, "site/content/blog/agent-desktop-lifecycle")) throw new Error("Unexpected article directory");
await rm(directory, { recursive: true, force: true });
for (const [name, data] of files) {
  await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
  await writeFile(path.join(directory, name), data);
}
await writeFile(path.join(directory, "manifest.json"), JSON.stringify({
  source, sourceSha256: sha(bytes), locale: "zh-CN",
  translationStatus: "Chinese original; English translation not published",
  designSource: "Approved self-contained HTML, 2026-10-22",
  path: route, files: Object.fromEntries([...files].sort().map(([name, data]) => [name, sha(data)])),
}, null, 2) + "\n");
console.log(`Prepared ${route}: ${files.size} files; source ${sha(bytes)}`);
