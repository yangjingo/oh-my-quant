import { version } from "../data/brand.js";
import { icon, iconButton } from "./ui.js";

export function renderHeader() {
  return /* html */ `<header class="topbar" data-component="Header"><div class="brand"><img alt="JQ" src="assets/logo-mark.svg"/>WhyJ Quant <span class="brand-version">v${version}</span></div><div class="separator"></div><button aria-controls="projects" aria-expanded="false" class="switch" id="projectSwitch" title="展开研究侧栏"><span aria-hidden="true" class="sidebar-glyph">${icon("panel-left")}</span><span id="ticker">300308.SZ</span><span class="project-name" id="projectName">回撤结构研究</span></button><div class="top-actions"><span class="demo">交互原型 · 演示数据</span>${iconButton({ name: "square-pen", label: "新建会话", id: "newResearch", className: "new-button", type: "button" })}${iconButton({ name: "settings-2", label: "界面设置", className: "settings-button", type: "button", attrs: { "data-modal": "settings" } })}${iconButton({ name: "panel-right", label: "切换研究概览", id: "togglePanel", className: "", type: "button" })}</div></header>`;
}
