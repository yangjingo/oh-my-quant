import { readFile } from "node:fs/promises";
import { chartCard } from "./charts.js";

// Editorial source remains Markdown. These views only enrich existing material.
export async function enrichArticle(body: string, imageDirectory: string, icon: (name: string) => string) {
  let charts = 0;
  body = body.replace(/<p><img src="\.\/images\/repo-ops-(actions|rsi)\.svg" alt="[^"]*"[^>]*><\/p>\s*<p><em>([\s\S]*?)<\/em><\/p>/g, (_, name, caption) => {
    charts++;
    return chartCard(name === "actions" ? "bar" : "line", caption, icon);
  });
  if (charts !== 2) throw new Error("Expected the two evidence charts in the Markdown argument");
  let table = 0;
  const titles = ["规则与职责", "工作流与验证边界", "故障注入与验证结果"];
  body = body.replace(/<div class="table-scroll"[^>]*>(<table>[\s\S]*?<\/table>)<\/div>/g, (_, content) => {
    const id = ++table;
    return `<section class="interactive-table" id="table-${id}" aria-label="${titles[id - 1]}"><div class="component-header"><p class="component-title">表 ${id} · ${titles[id - 1]}</p><div class="table-tools" hidden><button class="quiet-icon" type="button" data-settings aria-label="筛选与显示列" title="筛选与显示列" aria-expanded="false" aria-controls="table-settings-${id}">${icon('settings-2')}</button><button class="quiet-icon" type="button" data-select aria-label="选择项目对比" title="选择项目对比" aria-pressed="false">${icon('columns-2')}</button><button class="quiet-icon" type="button" data-expand aria-label="展开阅读" title="展开阅读">${icon('maximize-2')}</button></div></div><div class="table-settings" id="table-settings-${id}" hidden><label class="table-search">搜索全表<input type="search" autocomplete="off" aria-controls="table-data-${id}"></label><div class="column-options"></div><button class="text-action" type="button" data-reset>重置筛选与列</button></div><div class="table-state" hidden><output aria-live="polite"></output><button class="text-action" type="button" data-compare hidden>对比所选</button><button class="quiet-icon" type="button" data-cancel aria-label="退出对比" title="退出对比" hidden>${icon('x')}</button></div><div class="table-scroll" tabindex="0" role="region" aria-label="${titles[id - 1]}，可横向滚动">${content.replace('<table>', `<table id="table-data-${id}">`)}</div><p class="table-empty" hidden>没有匹配的行，请修改关键词或重置。</p></section>`;
  });
  if (table !== titles.length) throw new Error("Review titles for changed Markdown tables");

  const variants = await Promise.all(["", "-mobile"].map(async (suffix, index) => {
    let svg = await readFile(`${imageDirectory}/repo-ops-merge-flow${suffix}.svg`, "utf8");
    // Each inline instance gets its own title, description and marker IDs.
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    for (const id of ids) {
      svg = svg.replaceAll(`id="${id}"`, `id="flow-${index}-${id}"`)
        .replaceAll(`#${id})`, `#flow-${index}-${id})`);
    }
    svg = svg.replace(/aria-labelledby="([^"]+)"/, (_, value) => `aria-labelledby="${value.split(" ").map((id: string) => `flow-${index}-${id}`).join(" ")}"`);
    return `<div class="flow-${index ? 'mobile' : 'desktop'}">${svg}</div>`;
  }));
  body = body.replace(/(<figure class="article-figure" id="figure-4">[\s\S]*?<\/figure>)/, `$1
    <section class="flow-demo" id="flow-demo" aria-label="合并流程分步演示" hidden>
      <div class="flow-tools" lang="en"><output aria-live="polite">Overview</output><div class="flow-actions"><button class="quiet-icon" type="button" data-previous aria-label="Previous step" title="Previous step">${icon('chevron-left')}</button><button class="quiet-icon" type="button" data-play aria-label="Play" title="Play">${icon('play')}</button><button class="quiet-icon" type="button" data-next aria-label="Next step" title="Next step">${icon('chevron-right')}</button><button class="quiet-icon" type="button" data-overview aria-label="Reset flow" title="Reset flow">${icon('rotate-ccw')}</button></div></div>
      <div class="flow-canvas" lang="en">${variants.join("")}</div>
      <p class="component-note">示意流程，可逐步查看；不代表当前 GitHub 检查状态。静态原图保留在上方。</p>
    </section>`);

  // References stay ordinary Markdown links; only body media gets a preview.
  const recording = `<details id="local-video" class="body-video"><summary aria-controls="local-video-player"><img class="video-thumbnail" src="./assets/figures/repo-ops-merge-flow.svg" width="1120" height="1200" loading="lazy" alt="合并流程演示的静态图封面"><span class="video-preview-copy"><strong>合并流程 · 无声演示</strong><span>查看一次改动如何经过 CI、PR 策略和最终核验。图 6 的示意录屏，非实时 Actions。</span><span class="video-preview-action">${icon('play')}<span class="video-expand-label">展开视频</span><span class="video-collapse-label">收起视频</span></span></span></summary><figure class="media-card" id="local-video-player">
      <div class="media-stage media-native"><video controls playsinline preload="none" width="1120" height="1200" poster="./assets/figures/repo-ops-merge-flow.svg" aria-label="Merge flow — illustrative UI demonstration" aria-describedby="local-video-caption"><source src="./assets/media/merge-flow-demo.mp4" type="video/mp4">浏览器无法播放此视频，请使用下方下载链接。</video></div>
      <figcaption id="local-video-caption"><strong lang="en">Merge flow — illustrative UI demonstration</strong><span>图 6 分步演示的无声录屏，不代表当前 Actions 状态。完整解释见相邻正文。</span><div class="media-actions"><a href="./assets/media/merge-flow-demo.mp4" download>下载演示视频</a><a href="#figure-4">查看静态图与交互演示</a></div><p class="media-status" data-native-status role="status" hidden></p></figcaption>
    </figure></details>`;
  body = body.replace(/(<section class="flow-demo"[\s\S]*?<\/section>)/, `$1${recording}`);
  return `<template id="blog-control-icons">${['x', 'play', 'pause'].map(icon).join('')}</template>${body}`;
}
