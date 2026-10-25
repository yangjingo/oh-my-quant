import { version } from "../data/brand.js";
import {
  icon,
  iconButton,
  escapeHtml,
  section,
  fieldRow,
  actionButton,
} from "./ui.js";
import { environmentPages } from "./environment-settings.js";
import { commands } from "../data/commands.js";

export function renderModalShell() {
  return `<dialog id="modal" class="app-dialog" aria-labelledby="modalTitle" data-component="ModalShell">
    <header class="modal-header" data-region="header"><span id="modalTitle"></span>${iconButton({ id: "modalClose", name: "x", label: "关闭窗口" })}</header>
    <div class="dialog-body" id="modalBody" data-region="body"></div>
  </dialog><div class="toast" id="toast" role="status" hidden></div>`;
}

/** One modal owner, one layout, reusable sections/rows for every dialog type. */
export function createModalController({
  getSession,
  onRename,
  onDetailChange,
  onEnvironmentChange,
  getRuntime,
  stopRun,
}) {
  const dialog = document.querySelector("#modal"),
    body = document.querySelector("#modalBody");
  const preferences = {
    fontSize: 13,
    detailed: false,
    modelProvider: "none",
    modelName: "",
    marketSource: "demo",
  };
  try {
    const saved = JSON.parse(
      localStorage.getItem("quant-preview.preferences") || "{}",
    );
    if (["none", "compatible", "local"].includes(saved.modelProvider))
      preferences.modelProvider = saved.modelProvider;
    if (typeof saved.modelName === "string")
      preferences.modelName = saved.modelName.trim().slice(0, 80);
    if (["demo", "akshare", "none"].includes(saved.marketSource))
      preferences.marketSource = saved.marketSource;
    if ([13, 15, 16].includes(saved.fontSize))
      preferences.fontSize = saved.fontSize;
    if (typeof saved.detailed === "boolean")
      preferences.detailed = saved.detailed;
  } catch {
    /* A blocked or malformed local store does not prevent rendering. */
  }
  function applyPreferences() {
    document
      .querySelector("#app")
      .style.setProperty("--answer-font-size", preferences.fontSize + "px");
  }
  function savePreferences() {
    applyPreferences();
    try {
      localStorage.setItem(
        "quant-preview.preferences",
        JSON.stringify(preferences),
      );
    } catch {}
  }
  applyPreferences();
  document.querySelector("#modalClose").onclick = () => dialog.close();
  dialog.onclick = (e) => {
    if (e.target === dialog) dialog.close();
  };
  const note = (text) => `<p class="modal-note">${escapeHtml(text)}</p>`;

  let disposePage;
  dialog.addEventListener("close", () => {
    disposePage?.();
    disposePage = undefined;
  });

  function mount({
    title,
    pages,
    footer = "本地交互预览",
    actions = "",
    afterRender,
    initialPage,
  }) {
    document.querySelector("#modalTitle").textContent = title;
    const hasNavigation = pages.length > 1;
    body.innerHTML = `<div class="modal-layout ${hasNavigation ? "" : "single-region"}" data-component="ModalLayout">
      ${hasNavigation ? `<div class="modal-navigation" role="tablist" aria-label="${escapeHtml(title)}分区" aria-orientation="vertical" data-region="navigation">${pages.map((page, i) => `<button type="button" role="tab" id="modal-tab-${page.id}" data-page="${page.id}" aria-selected="${i === 0}" aria-controls="modalContent" tabindex="${i === 0 ? 0 : -1}">${icon(page.icon || "file-text")}<span>${escapeHtml(page.label)}</span></button>`).join("")}</div>` : ""}
      <div class="modal-main" data-region="main"><div id="modalContent" class="modal-content" ${hasNavigation ? 'role="tabpanel"' : 'role="region"'} tabindex="0" data-region="content"></div><div class="modal-actions" data-region="actions"><span class="modal-footnote">${escapeHtml(footer)}</span><div class="modal-action-buttons">${actions}</div></div></div>
    </div>`;
    const buttons = [...body.querySelectorAll("[data-page]")];
    function select(id) {
      const page = pages.find((p) => p.id === id);
      if (!page) return;
      buttons.forEach((button) => {
        const selected = button.dataset.page === id;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      const content = document.querySelector("#modalContent");
      disposePage?.();
      content.innerHTML = page.render();
      if (hasNavigation)
        content.setAttribute("aria-labelledby", "modal-tab-" + id);
      else content.setAttribute("aria-label", page.label);
      disposePage = page.bind?.(content);
    }
    buttons.forEach((button, index) => {
      button.onclick = () => select(button.dataset.page);
      button.onkeydown = (e) => {
        let next;
        if (["ArrowDown", "ArrowRight"].includes(e.key))
          next = (index + 1) % buttons.length;
        else if (["ArrowUp", "ArrowLeft"].includes(e.key))
          next = (index - 1 + buttons.length) % buttons.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = buttons.length - 1;
        if (next === undefined) return;
        e.preventDefault();
        select(buttons[next].dataset.page);
        buttons[next].focus();
      };
    });
    select(pages.some((p) => p.id === initialPage) ? initialPage : pages[0].id);
    afterRender?.();
    if (!dialog.open) dialog.showModal();
    if (initialPage) {
      const selected = body.querySelector(`[data-page="${initialPage}"]`);
      selected?.focus();
      selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function settings(initialPage = "appearance") {
    mount({
      title: "设置",
      footer: "设置自动保存在此浏览器 · 外部服务尚未连接",
      initialPage,
      pages: [
        {
          id: "appearance",
          label: "阅读与界面",
          icon: "sliders-horizontal",
          render: () =>
            section({
              id: "reading",
              title: "阅读",
              description: "统一应用于当前和后续会话。",
              content:
                fieldRow({
                  label: "正文字号",
                  description: "研究回答的阅读大小",
                  forId: "fontSize",
                  control: `<select id="fontSize">${[
                    [13, "标准 · 13px"],
                    [15, "舒适 · 15px"],
                    [16, "大号 · 16px"],
                  ]
                    .map(
                      ([value, label]) =>
                        `<option value="${value}" ${value === preferences.fontSize ? "selected" : ""}>${label}</option>`,
                    )
                    .join("")}</select>`,
                }) +
                fieldRow({
                  label: "研究过程",
                  description: "默认收起过程，让问题与回答优先呈现",
                  forId: "detailMode",
                  control: `<select id="detailMode"><option value="compact" ${!preferences.detailed ? "selected" : ""}>极简 · 收起</option><option value="detailed" ${preferences.detailed ? "selected" : ""}>详细 · 展开</option></select>`,
                }),
            }) +
            section({
              id: "theme",
              title: "终端外观",
              content:
                fieldRow({
                  label: "主题",
                  description: "深色背景、等宽字体、金色强调",
                  status: "WhyJ Terminal",
                }) +
                fieldRow({
                  label: "行情颜色",
                  description: "价格涨跌与操作状态分别表达",
                  status: "红涨 · 绿跌",
                }),
            }),
          bind: () => {
            document.querySelector("#fontSize").onchange = (e) => {
              preferences.fontSize = Number(e.target.value);
              savePreferences();
            };
            document.querySelector("#detailMode").onchange = (e) => {
              preferences.detailed = e.target.value === "detailed";
              savePreferences();
              onDetailChange(preferences.detailed);
            };
          },
        },
        ...environmentPages({
          preferences,
          save: () => {
            savePreferences();
            onEnvironmentChange(preferences);
          },
          getRuntime,
          stopRun,
        }),
        {
          id: "about",
          label: "关于",
          icon: "info",
          render: () =>
            section({
              id: "product",
              title: "WhyJ Quant",
              content:
                fieldRow({ label: "版本", status: `v${version}` }) +
                fieldRow({ label: "当前环境", status: "Web 交互原型" }),
            }) + note("页面保留终端风格。示例研究不代表真实行情或模型结论。"),
        },
      ],
    });
  }

  function evidence() {
    const available = ["标的日线", "沪深300日线", "相对强弱", "成交量"];
    mount({
      title: "研究证据",
      footer: "本地合成 · 2026.10.24",
      pages: [
        {
          id: "available",
          label: "可用证据 · 4",
          icon: "check",
          render: () =>
            section({
              id: "available-evidence",
              title: "可用证据",
              description: "同一区间对齐，均为演示记录。",
              content: available
                .map((label, i) =>
                  fieldRow({
                    label: `[${i + 1}] ${label}`,
                    description: "本地合成样本 · 2026.10.24",
                    status: "示例可用",
                  }),
                )
                .join(""),
            }),
        },
        {
          id: "missing",
          label: "待补充 · 2",
          icon: "circle-alert",
          render: () =>
            section({
              id: "missing-evidence",
              title: "判断边界",
              description: "以下内容未取得，不作为当前判断依据。",
              content: ["公司公告", "基本面变化"]
                .map((label, i) =>
                  fieldRow({
                    label: `[${i + 5}] ${label}`,
                    description: "需要进一步核对原始资料",
                    status: "未核对",
                  }),
                )
                .join(""),
            }),
        },
      ],
    });
  }

  function report() {
    mount({
      title: "研究报告",
      footer: "合成演示 · 非真实研究结果",
      actions: actionButton({
        id: "download",
        label: "下载 Markdown",
        iconName: "arrow-down",
        primary: true,
      }),
      afterRender: () => {
        document.querySelector("#download").onclick = () => {
          const text =
            "# 回撤结构研究（交互原型示例）\n\n所有数据为合成演示，不代表真实行情。\n\n暂定结论：上涨后的回撤观察，相对强弱尚未同步走坏。\n\n判断边界：公司公告和基本面变化尚未核对。";
          const url = URL.createObjectURL(
            new Blob([text], { type: "text/markdown;charset=utf-8" }),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = "research-demo.md";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
      },
      pages: [
        {
          id: "summary",
          label: "研究摘要",
          icon: "file-text",
          render: () =>
            section({
              id: "conclusion",
              title: "300308.SZ 回撤结构研究",
              content:
                '<div class="prose-block"><p>暂定结论：上涨后的回撤观察，相对强弱尚未同步走坏。</p><p>判断边界：公司公告及基本面变化尚未核对，不能由价格图表直接推断经营情况。</p></div>',
            }),
        },
        {
          id: "versions",
          label: "版本记录",
          icon: "list-tree",
          render: () =>
            section({
              id: "version-history",
              title: "版本记录",
              content:
                fieldRow({
                  label: "v2 · 2026.10.24 14:32",
                  description: "补充判断边界与证据缺失项",
                  status: "当前",
                }) +
                fieldRow({
                  label: "v1 · 2026.10.23 16:05",
                  description: "初始观察版本",
                  status: "历史",
                }),
            }),
        },
      ],
    });
  }

  function help() {
    mount({
      title: "命令与快捷键",
      footer: "↑ ↓ 选择 · Enter / Tab 确认 · Esc 收起",
      pages: ["研究", "环境", "Web 操作"].map((group, i) => ({
        id: "commands-" + i,
        label: group,
        icon: i === 1 ? "settings-2" : "list-tree",
        render: () =>
          section({
            id: "command-group-" + i,
            title: group,
            description: "命令名称与 CLI 对齐，Web 操作单独列出。",
            content: commands
              .filter((c) => c.group === group)
              .map((c) =>
                fieldRow({
                  label: c.label,
                  description: c.description,
                  status: c.action === "host" ? "需连接" : "本地可用",
                }),
              )
              .join(""),
          }) +
          (i === 0
            ? note("/ 搜索命令；@ 引用文件与研究；Shift + Enter 换行。")
            : ""),
      })),
    });
  }

  function rename() {
    const session = getSession();
    mount({
      title: "会话设置",
      footer: "只修改当前会话名称",
      actions: actionButton({
        id: "saveSessionName",
        label: "保存",
        primary: true,
      }),
      pages: [
        {
          id: "session",
          label: "基本信息",
          render: () =>
            section({
              id: "session-info",
              title: "基本信息",
              content: `<form id="renameForm">${fieldRow({ label: "会话名称", forId: "renameInput", control: `<input class="rename-input" id="renameInput" maxlength="60" required value="${escapeHtml(session.title)}">` })}</form>`,
            }),
          bind: () => {
            document.querySelector("#renameForm").onsubmit = (e) => {
              e.preventDefault();
              const value = document.querySelector("#renameInput").value.trim();
              if (!value) return;
              onRename(value);
              dialog.close();
            };
          },
        },
      ],
      afterRender: () => {
        document.querySelector("#saveSessionName").onclick = () =>
          document.querySelector("#renameForm").requestSubmit();
      },
    });
    document.querySelector("#renameInput").focus();
    document.querySelector("#renameInput").select();
  }

  function open(kind) {
    if (["model", "sources", "runtime"].includes(kind)) {
      settings(kind);
      return;
    }
    if (["evidence", "report"].includes(kind) && getSession().id !== "sample") {
      mount({
        title: kind === "evidence" ? "研究证据" : "研究报告",
        pages: [
          {
            id: "empty",
            label: "当前会话",
            render: () =>
              section({
                id: "empty-result",
                title: "暂无研究结果",
                description: "连接模型与数据源后，证据和报告会随研究生成。",
                content: note("你可以继续输入研究问题。"),
              }),
          },
        ],
      });
      return;
    }
    (({ settings, evidence, report, commands: help, rename })[kind] || help)();
  }
  return { open, preferences };
}
