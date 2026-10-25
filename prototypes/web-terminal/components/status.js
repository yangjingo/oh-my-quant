import { icon, escapeHtml } from "./ui.js";
import { marketData } from "../data/market.js";

export function sourceLabel(available, source = "demo") {
  if (source === "akshare") return "AKShare · 未连接";
  if (source === "none") return "数据源未启用";
  return available ? marketData.source : "示例 · 暂无数据";
}

export function updateStatus(preferences, available) {
  const model =
    preferences.modelProvider !== "none" && preferences.modelName
      ? preferences.modelName + " · 未连接"
      : "模型未连接";
  document.querySelector("#modelStatus").textContent = model;
  document.querySelector(".status-model").title = "选择模型 · " + model;
  document.querySelector("#sourceStatus").textContent = sourceLabel(
    available,
    preferences.marketSource,
  );
}

export function renderStatus() {
  return `<footer class="status" data-component="Status"><button type="button" class="status-model" data-modal="model" aria-label="选择模型" title="选择模型" aria-haspopup="dialog">${icon("cpu")}<span id="modelStatus">模型未连接</span></button><button type="button" class="status-source" id="sourceStatus" data-modal="sources" aria-label="设置数据源" title="更换数据源" aria-haspopup="dialog">${escapeHtml(sourceLabel(true))}</button><button type="button" class="state" id="statusText" data-modal="runtime" aria-label="查看运行状态" title="运行状态与控制" aria-haspopup="dialog">● 就绪</button><span class="right">RESEARCH BEFORE CONVICTION.</span></footer>`;
}
