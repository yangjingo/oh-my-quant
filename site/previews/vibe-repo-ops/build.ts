import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname, basename } from "node:path";
import { buildFigures } from "./figures.ts";
import { enrichArticle } from "./interactive.ts";
import { chartSvg } from "./charts.js";

// Review-only output. The production route table and public asset allowlist are unchanged.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const sourcePath = resolve(root, "docs/blog/agentic/vibe-repo-ops-merged-draft.md");
const output = resolve(root, process.env.BLOG_PREVIEW_OUTPUT || "output/blog-preview");
const published = process.env.BLOG_PUBLISH === "1";
const canonical = "https://oh-my-quant.vercel.app/blog/vibe-repo-ops/";
await buildFigures(root);
const chartFiles = ["repo-ops-actions.svg", "repo-ops-rsi.svg"];
const chartTheme = await readFile(new URL("./brand/theme.css", import.meta.url), "utf8");
for (const [index, name] of chartFiles.entries()) {
  const kind = index === 0 ? "bar" : "line";
  let svg = chartSvg(kind).replace('height="312"', 'height="410"').replace('0 0 680 312', '0 0 680 410');
  const title = kind === "bar" ? "Actions outcomes / 2026-10-17" : "RSI counterexample / period 2";
  const legend = kind === "bar" ? "61 runs: 35 success / 18 failure / 8 cancelled. 62 attempts." : "Legacy: cream / dashed. Correct: gold / solid. T1-T2: N/A.";
  svg = svg.replace(/(<svg[^>]*>)/, `$1<rect width="680" height="410" fill="var(--canvas)"/><text x="40" y="30" fill="var(--ink)" font-size="22">${title}</text><g transform="translate(0 52)">`).replace('</svg>', `</g><text x="40" y="394" fill="var(--muted)" font-size="13">${legend}</text></svg>`);
  svg = svg.replace(/var\(--([\w-]+)\)/g, (_, token) => {
    const value = chartTheme.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]+)`))?.[1];
    if (!value) throw new Error(`Missing chart theme token: ${token}`);
    return value;
  });
  await writeFile(resolve(dirname(sourcePath), "images", name), svg);
}
const sprites = await readFile(resolve(root, "site/public/icons.svg"), "utf8");
const icons = new Map([...sprites.matchAll(/<symbol id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g)].map(m => [m[1], m[2]]));
for (const name of ["printer", "maximize-2", "download", "arrow-up", "columns-2", "rotate-ccw", "play", "pause", "chevron-left", "chevron-right", "share-2", "clock"]) {
  const svg = await readFile(new URL(`./icons/${name}.svg`, import.meta.url), "utf8");
  const paths = svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)?.[1];
  if (!paths) throw new Error(`Invalid Lucide asset: ${name}`);
  icons.set(name, paths);
}
const icon = (name: string) => {
  const paths = icons.get(name);
  if (!paths) throw new Error(`Missing Lucide icon: ${name}`);
  return `<svg class="icon" data-icon="${name}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
};
const source = (await readFile(sourcePath, "utf8")).replace(/\r\n/g, "\n");
const [titleLine, , metadata, ...bodyLines] = source.split("\n");
if (!titleLine.startsWith("# ") || !metadata.includes("合并审阅稿")) {
  throw new Error("Expected the reviewed Markdown title and draft metadata");
}
const title = titleLine.slice(2);
const date = metadata.match(/\d{4}-\d{2}-\d{2}/)?.[0];
if (!date) throw new Error("Missing article date");
const [series, ...titleParts] = title.split("：");
const mainTitle = titleParts.join("：");
const esc = (text: string) => text.replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]!));
const sections: { id: string; title: string; children: { id: string; title: string }[] }[] = [];
const imageDimensions = new Map<string, { width: string; height: string }>();
const imageVersions = new Map<string, string>();
for (const name of ["artifacts", "evidence", "governance", "merge-flow"].flatMap(name => [`repo-ops-${name}.svg`, `repo-ops-${name}-mobile.svg`])) {
  const svg = await readFile(resolve(dirname(sourcePath), "images", name), "utf8");
  const size = svg.match(/<svg\b[^>]*width="(\d+)" height="(\d+)"/);
  if (!size) throw new Error(`Missing image dimensions: ${name}`);
  imageDimensions.set(name, { width: size[1], height: size[2] });
  imageVersions.set(name, Bun.hash(svg).toString(16));
}
const assetUrl = (name: string) => `./assets/figures/${name}?v=${imageVersions.get(name)}`;
let body = Bun.markdown.html(bodyLines.join("\n"));
const figureCopies: { source: string; target: string }[] = [];
for (const name of chartFiles) figureCopies.push({ source: resolve(dirname(sourcePath), "images", name), target: resolve(output, "assets/figures", name) });
let figureCount = 0;
body = body.replace(/<p><img src="(\.\/images\/repo-ops-(?:governance|artifacts|evidence|merge-flow)\.svg)" alt="([^"]*)"[^>]*><\/p>\s*<p><em>([\s\S]*?)<\/em><\/p>/g, (_, path, alt, caption) => {
  const name = basename(path);
  const mobileName = name.endsWith(".svg") ? name.replace(".svg", "-mobile.svg") : undefined;
  const size = imageDimensions.get(name)!;
  if (!size) throw new Error(`Missing image dimensions: ${name}`);
  let mobileSource = "";
  if (mobileName) {
    const mobileSize = imageDimensions.get(mobileName)!;
    mobileSource = `<source media="(max-width: 600px)" srcset="${assetUrl(mobileName)}" width="${mobileSize.width}" height="${mobileSize.height}">`;
  }
  for (const file of mobileName ? [name, mobileName] : [name]) figureCopies.push({ source: resolve(dirname(sourcePath), "images", file), target: resolve(output, "assets/figures", file) });
  const number = ++figureCount;
  const displayNumber = caption.match(/^图\s*(\d+)/)?.[1] ?? number;
  return `<figure class="article-figure" id="figure-${number}"><a class="figure-link" href="${assetUrl(name)}" data-figure aria-label="放大图 ${displayNumber}" aria-describedby="figure-caption-${number}"><picture>${mobileSource}<img src="${assetUrl(name)}" width="${size.width}" height="${size.height}" alt="${alt}" loading="lazy" decoding="async"></picture><span class="figure-zoom">${icon("maximize-2")}<span>放大查看</span></span></a><figcaption id="figure-caption-${number}">${caption}</figcaption></figure>`;
});
if (figureCount !== 4) throw new Error("Expected four technical figures and their captions");
body = body.replace(/<h([23])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>/g, (_, level, heading) => {
  if (level === "2") {
    const id = `section-${sections.length + 1}`;
    sections.push({ id, title: heading, children: [] });
    return `<h2 id="${id}" tabindex="-1">${heading}</h2>`;
  }
  const parent = sections.at(-1);
  if (!parent) throw new Error("Subheading before a section");
  const id = `${parent.id}-${parent.children.length + 1}`;
  parent.children.push({ id, title: heading });
  return `<h3 id="${id}" tabindex="-1">${heading}</h3>`;
});
body = body.replace(/<table>/g, '<div class="table-scroll" tabindex="0" role="region" aria-label="比较表，可横向滚动"><table>')
  .replace(/<\/table>/g, "</table></div>")
  .replace(/<pre>/g, '<pre tabindex="0" aria-label="代码示例，可横向滚动">');
if (sections.length !== 6 || sections[0].title !== "TL;DR" || !sections.at(-1)!.title.startsWith("References")) throw new Error("Expected TL;DR, four body sections, and References");
body = await enrichArticle(body, resolve(dirname(sourcePath), "images"), icon);
// Keep bibliography content in Markdown; only add layout and stable anchors here.
const referenceStart = body.indexOf('<h2 id="section-6"');
let referenceNumber = 0;
const references = body.slice(referenceStart).replace(/<ol(?: start="\d+")?>([\s\S]*?)<\/ol>/g, (_, entries) => {
  const start = referenceNumber + 1;
  const items = entries.replace(/<li>/g, () => `<li id="ref-${++referenceNumber}">`);
  return `<ol class="reference-list" start="${start}">${items}</ol>`;
});
if (referenceNumber !== 18) throw new Error("Expected 18 bibliography entries");
body = body.slice(0, referenceStart) + `<section class="references" aria-labelledby="section-6">${references}</section>`;
const previewAssets = ["article.css", "article.js", "interactive.css", "interactive.js", "tables.js", "charts.js"];
const assetVersions = new Map(await Promise.all(previewAssets.map(async name => [name, Bun.hash(await readFile(new URL(name, import.meta.url))).toString(16)] as const)));
const shortTitles = ["TL;DR", "产出加速后的问题", "重新定义“完成”", "让规则进入工作流", "结果、代价与边界", "References"];
const nav = sections.map((section, i) => `<li><a class="toc-link" href="#${section.id}"><span class="toc-number">${String(i + 1).padStart(2, "0")}</span><span>${shortTitles[i]}</span></a><div class="toc-children-wrap"><div><ol class="toc-children">${section.children.map(child => `<li><a href="#${child.id}">${child.title}</a></li>`).join("")}</ol></div></div></li>`).join("\n");
const mobileNav = sections.map((section, i) => `<li><a href="#${section.id}"><span>${String(i + 1).padStart(2, "0")}</span>${shortTitles[i]}</a></li>`).join("");
const description = "从测试全绿却算错、文档漂移到 CI 生命周期竞态：oh-my-quant 如何让 AGENTS.md、Skills、验证与合并对同一次交付负责。";
const readingText = source.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/<[^>]*>/g, "");
const readMinutes = Math.max(1, Math.ceil((readingText.match(/[\u4e00-\u9fff]/g)?.length ?? 0) / 350 + (readingText.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g)?.length ?? 0) / 220));
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0C0C0C">
  <meta name="color-scheme" content="dark">
  ${published ? `<link rel="canonical" href="${canonical}"><meta property="og:url" content="${canonical}">` : '<meta name="robots" content="noindex, nofollow">'}
  <meta name="description" content="${esc(description)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <title>${esc(title)} · WhyJ Quant</title>
  <link rel="icon" href="./assets/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="./assets/theme.css">
  <link rel="stylesheet" href="./assets/article.css?v=${assetVersions.get('article.css')}">
  <link rel="stylesheet" href="./assets/interactive.css?v=${assetVersions.get('interactive.css')}">
  <script defer src="./assets/article.js?v=${assetVersions.get('article.js')}"></script>
  <script defer src="./assets/interactive.js?v=${assetVersions.get('interactive.js')}"></script>
  <script defer src="./assets/tables.js?v=${assetVersions.get('tables.js')}"></script>
  <script type="module" src="./assets/charts.js?v=${assetVersions.get('charts.js')}"></script>
</head>
<body id="top">
  <a class="skip-link" href="#article">跳到正文</a>
  <header class="site-header">
    <div class="nav-shell">
      <a class="brand" href="${published ? '/' : 'https://oh-my-quant.vercel.app/'}" aria-label="WhyJ Quant 官网"><img class="brand-mark" src="./assets/logo-mark.svg" width="32" height="32" alt="" aria-hidden="true"><span>WhyJ Quant</span></a>
      <nav class="site-nav" aria-label="网站导航"><a href="${published ? '/blog/' : 'https://oh-my-quant.vercel.app/blog/'}">Blog</a><a class="icon-link" href="https://github.com/yangjingo/oh-my-quant" aria-label="GitHub 仓库" title="GitHub">${icon("github")}</a></nav>
    </div>
    <progress id="reading-progress" max="100" value="0" aria-label="文章阅读进度" hidden></progress>
  </header>
  <main class="reading-layout">
      <header class="article-header">
        <h1><span class="series-title" lang="en">${esc(series)}</span><span class="main-title">${esc(mainTitle)}</span></h1>
        <div class="article-meta"><span class="author">WhyJ</span><span>oh-my-quant</span><time datetime="${date}">${date.replaceAll("-", ".")}</time>${published ? '' : '<span class="draft-label">合并审阅稿</span>'}</div>
        <div class="article-utilities"><span class="reading-time" title="根据当前正文长度估算">${icon('clock')}预计阅读 ${readMinutes} 分钟</span><div class="article-actions"><button id="share-article" class="article-action" type="button" aria-label="分享文章或复制链接" title="分享文章；不支持系统分享时复制链接" hidden>${icon('share-2')}<span>分享</span></button><button id="print-article" class="article-action" type="button" aria-label="打印或保存为 PDF" title="打开打印窗口，可选择保存为 PDF" hidden>${icon('printer')}<span>PDF</span></button></div></div>
        <p id="article-action-status" class="action-status" role="status"></p><a id="share-fallback" class="share-fallback" hidden>当前页面链接</a>
      </header>
    <aside class="sidebar" aria-label="阅读辅助">
      <div class="sidebar-inner"><div class="sidebar-reveal"><p class="sidebar-label">本文内容</p><nav aria-label="文章目录"><ol class="toc">${nav}</ol></nav></div></div>
    </aside>
    <div class="main-column">
      <details class="mobile-contents"><summary>文章目录 ${icon("chevron-down")}</summary><nav aria-label="移动端文章目录"><ol>${mobileNav}</ol></nav></details>
      <article class="prose" id="article" tabindex="-1">${body}</article>
      <div class="article-end"><span>WhyJ <span class="end-dot" aria-hidden="true">·</span> ${date.slice(0, 4)}</span><a href="#top">返回顶部 ${icon("arrow-up")}</a></div>
    </div>
  </main>
  <footer class="site-footer"><a class="footer-brand" href="${published ? '/' : 'https://oh-my-quant.vercel.app/'}">WhyJ Quant</a><span>Research. Backtest. Analyze.</span></footer>
  <dialog class="figure-dialog" aria-labelledby="figure-dialog-title"><div class="figure-dialog-bar"><h2 id="figure-dialog-title">插图</h2><button class="icon-link" type="button" id="close-figure" aria-label="关闭放大图">${icon("x")}</button></div><div class="figure-dialog-canvas" tabindex="0" aria-label="放大图，可滚动查看"><img alt=""></div><p class="figure-dialog-caption"></p></dialog>
</body>
</html>
`;
await mkdir(resolve(output, "assets"), { recursive: true });
await mkdir(resolve(output, "assets/figures"), { recursive: true });
await mkdir(resolve(output, "assets/licenses"), { recursive: true });
await Promise.all([
  writeFile(resolve(output, "index.html"), html),
  ...previewAssets.map(name => cp(new URL(name, import.meta.url), resolve(output, "assets", name))),
  cp(new URL("./media/", import.meta.url), resolve(output, "assets/media"), { recursive: true }),
  cp(resolve(root, "site/public/fonts"), resolve(output, "assets/fonts"), { recursive: true }),
  ...["logo-mark.svg", "favicon.svg", "theme.css"].map(name => cp(new URL(`./brand/${name}`, import.meta.url), resolve(output, "assets", name))),
  cp(resolve(root, "site/public/licenses/lucide.txt"), resolve(output, "assets/licenses/lucide.txt")),
  ...figureCopies.map(file => cp(file.source, file.target)),
  ...figureCopies.map(file => { const name = basename(file.source); return mkdir(resolve(output, "images"), { recursive: true }).then(() => cp(file.source, resolve(output, "images", name))); }),
]);
const productionConfig = JSON.parse(await readFile(resolve(root, "site/vercel.json"), "utf8"));
// This directory can be served as static files; the draft deliberately remains noindex.
await writeFile(resolve(output, "vercel.json"), JSON.stringify({
  framework: null,
  buildCommand: "",
  installCommand: "",
  outputDirectory: ".",
  trailingSlash: true,
  headers: productionConfig.headers.filter((rule: { source: string }) => rule.source === "/(.*)"),
}, null, 2) + "\n");
console.log(`Rendered ${sections.length} sections, ${sections.reduce((n, s) => n + s.children.length, 0)} subheadings → ${output}/index.html`);
