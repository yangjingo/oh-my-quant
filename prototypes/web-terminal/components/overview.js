import { escapeHtml, icon, iconButton, panelHeader } from "./ui.js";
import { marketData, portfolios } from "../data/market.js";

function quoteRow(quote) {
  return `<div class="quote-row" data-component="QuoteRow"><div class="quote-line"><span class="quote-code">${escapeHtml(quote.code)}</span><span class="quote-name">${escapeHtml(quote.name)}</span><span class="quote-change ${quote.direction}">${escapeHtml(quote.change)}</span></div></div>`;
}

// Refresh describes the local event, never a common trading date for all rows.
// Opening the panel does not change the timestamp of retained values.
export function overviewContent(available = true, refresh = {}, portfolio = portfolios[0]) {
  const state = refresh.state || (available ? "demo" : "empty");
  const cues = {
    demo: "示例",
    ready: "",
    empty: "未刷新",
    loading: "刷新中",
    partial: "部分更新 · 含旧值",
    error: available ? "刷新失败 · 保留旧值" : "刷新失败",
    timeout: available ? "刷新超时 · 保留旧值" : "刷新超时",
  };
  const timestamp =
    refresh.refreshedAt === undefined
      ? available
        ? marketData.refreshedAt
        : null
      : refresh.refreshedAt;
  const header = panelHeader({
    title: "Overview",
    iconName: "panel-right",
    actions: iconButton({
      id: "closePanel",
      name: "panel-right-close",
      label: "收起概览",
      className: "quiet-control",
    }),
  });
  const refreshLine = `<div class="overview-refresh" data-region="refresh" role="status"><span title="本地刷新事件时间，不代表所有标的的交易日期；示例时间为固定演示记录。">Refresh: ${escapeHtml(timestamp || "—")}</span><span class="refresh-cue" data-state="${escapeHtml(state)}">${escapeHtml(cues[state] ?? "状态未知")}</span></div>`;
  if (!available)
    return `${header}${refreshLine}<div class="empty-overview" data-region="empty">暂无研究数据。<br><small>模型与行情数据源尚未连接。</small></div>`;
  return `${header}${refreshLine}<div class="overview-body" data-region="content">
    <details class="overview-group portfolio-group" open data-component="QuoteGroup"><summary class="group-title"><span class="fold">${icon("chevron-down")}</span>${escapeHtml(portfolio.name)}<span class="count">${portfolio.quotes.length}</span></summary>${portfolio.quotes.map(quoteRow).join("")}</details>
    <div class="overview-group" data-component="QuoteGroup"><h2 class="group-title">Market<span class="count">${marketData.market.length}</span></h2>${marketData.market.map(quoteRow).join("")}</div>
  </div>`;
}

export function renderOverview() {
  return `<aside class="overview" id="overview" data-component="Overview">${overviewContent()}</aside>`;
}
