import { escapeHtml, section, fieldRow, actionButton } from "./ui.js";
import { portfolios } from "../data/market.js";

const options = (items, selected) =>
  items
    .map(
      ([value, label]) =>
        `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`,
    )
    .join("");

export function environmentPages({ preferences, save, getRuntime, stopRun }) {
  return [
    {
      id: "model",
      label: "模型",
      icon: "cpu",
      render: () =>
        section({
          id: "model-choice",
          title: "模型选择",
          description: "选择研究使用的模型配置。",
          content:
            fieldRow({
              label: "服务类型",
              forId: "modelProvider",
              control: `<select id="modelProvider">${options(
                [
                  ["none", "暂不配置"],
                  ["compatible", "OpenAI 兼容服务"],
                  ["local", "本地模型服务"],
                ],
                preferences.modelProvider,
              )}</select>`,
            }) +
            fieldRow({
              label: "模型名称",
              description: "填写服务提供的模型 ID",
              forId: "modelName",
              control: `<input id="modelName" maxlength="80" placeholder="输入模型 ID" value="${escapeHtml(preferences.modelName)}" ${preferences.modelProvider === "none" ? "disabled" : ""}>`,
            }),
        }) +
        section({
          id: "model-connection",
          title: "连接状态",
          content: fieldRow({
            label: "运行服务",
            description: "此原型仅保存选择，不发送模型请求",
            status: "未连接",
          }),
        }),
      bind: (root) => {
        const provider = root.querySelector("#modelProvider"),
          name = root.querySelector("#modelName");
        provider.onchange = () => {
          preferences.modelProvider = provider.value;
          name.disabled = provider.value === "none";
          save();
        };
        name.oninput = () => {
          preferences.modelName = name.value.trim().slice(0, 80);
          name.value = preferences.modelName;
          save();
        };
      },
    },
    {
      id: "sources",
      label: "数据源",
      icon: "database",
      render: () =>
        section({
          id: "source-choice",
          title: "行情数据",
          description: "数据源选择与当前行情的真实来源分别展示。",
          content:
            fieldRow({
              label: "首选来源",
              forId: "marketSource",
              control: `<select id="marketSource">${options(
                [
                  ["demo", "本地合成 · 示例"],
                  ["akshare", "AKShare"],
                  ["none", "暂不启用"],
                ],
                preferences.marketSource,
              )}</select>`,
            }) +
            fieldRow({
              label: "当前状态",
              description: "切换到外部来源后，Overview 不继续展示合成行情",
              control: '<span id="sourceConnection"></span>',
            }),
        }) +
        section({
          id: "context-source",
          title: "文件与历史研究",
          content: fieldRow({
            label: "上下文来源",
            description: "@ 引用示例文件及本页会话",
            status: "本地预览",
          }),
        }),
      bind: (root) => {
        const select = root.querySelector("#marketSource");
        const update = () => {
          root.querySelector("#sourceConnection").textContent =
            preferences.marketSource === "demo"
              ? "合成示例可用"
              : preferences.marketSource === "none"
                ? "未启用"
                : "AKShare · 未连接";
        };
        select.onchange = () => {
          preferences.marketSource = select.value;
          save();
          update();
        };
        update();
      },
    },
    {
      id: "portfolio",
      label: "投资组合",
      icon: "list-tree",
      render: () => section({
        id: "portfolio-choice",
        title: "投资组合",
        description: "切换 Overview 中查看的组合，保留当前研究对话。",
        content: fieldRow({
          label: "当前组合",
          forId: "portfolioSelect",
          description: "示例组合 · 选择保存在此浏览器",
          control: `<select id="portfolioSelect">${options(portfolios.map((item) => [item.id, item.name]), preferences.portfolioId)}</select>`,
        }),
      }),
      bind: (root) => {
        root.querySelector("#portfolioSelect").onchange = (event) => {
          preferences.portfolioId = event.target.value;
          save();
        };
      },
    },
    {
      id: "runtime",
      label: "运行状态",
      icon: "info",
      render: () =>
        section({
          id: "run-state",
          title: "当前会话",
          content:
            fieldRow({ label: "会话", status: getRuntime().title }) +
            fieldRow({
              label: "运行状态",
              control: '<span id="runtimeState" role="status"></span>',
            }) +
            fieldRow({
              label: "执行环境",
              description: "演示运行不会调用模型或行情服务",
              status: "本地交互原型",
            }),
        }) +
        `<div class="runtime-actions">${actionButton({ id: "stopRuntime", label: "停止当前演示", iconName: "square" })}</div>`,
      bind: (root) => {
        const button = root.querySelector("#stopRuntime");
        const update = () => {
          const state = getRuntime();
          root.querySelector("#runtimeState").textContent = state.running
            ? "演示运行中"
            : state.status;
          button.disabled = !state.running;
        };
        button.onclick = () => {
          stopRun();
          update();
        };
        update();
        const observer = new MutationObserver(update);
        observer.observe(document.querySelector("#runSummary"), {
          childList: true,
          subtree: true,
          characterData: true,
        });
        return () => observer.disconnect();
      },
    },
  ];
}
