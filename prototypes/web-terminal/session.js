import { icon } from "./components/ui.js";
import { renderSessionList } from "./components/sidebar.js";
import {
  emptyMarkup,
  prepareLongMessages,
  createDemoTurn,
  createDemoAnswer,
} from "./components/stream.js";
import { overviewContent } from "./components/overview.js";
import { updateStatus } from "./components/status.js";
import { setSendState } from "./components/composer.js";
import { createModalController } from "./components/modal.js";
import { portfolios } from "./data/market.js";
const $ = (s) => document.querySelector(s),
  app = $("#app"),
  input = $("#input"),
  thread = $("#thread"),
  stream = $("#stream");
const initial = thread.innerHTML;
let activeProject = "sample",
  running = false,
  currentRun = null,
  serial = 0,
  detailed = false,
  toastTimer;
const sessions = new Map([
  [
    "sample",
    {
      id: "sample",
      title: "回撤结构研究",
      symbol: "300308.SZ",
      html: initial,
      scroll: 0,
      pinned: false,
      stamp: "14:32",
      group: "今天",
      status: "已完成",
      updated: 2,
    },
  ],
  [
    "empty",
    {
      id: "empty",
      title: "结构跟踪",
      symbol: "002048.SZ",
      html: "",
      scroll: 0,
      pinned: false,
      stamp: "10/23",
      group: "更早",
      status: "等待输入",
      updated: 1,
    },
  ],
]);
const dialogs = createModalController({
  onEnvironmentChange: refreshEnvironment,
  getRuntime: () => ({
    title: sessions.get(activeProject).title,
    status: sessions.get(activeProject).status,
    running,
  }),
  stopRun: stop,
  getSession: () => sessions.get(activeProject),
  onRename: (title) => {
    const session = sessions.get(activeProject);
    session.title = title;
    $("#sessionTitle").textContent = title;
    $("#projectName").textContent = title;
    renderSessions();
  },
  onDetailChange: (value) => {
    detailed = value;
    applyViewMode();
    updateJump();
  },
});
detailed = dialogs.preferences.detailed;
let overviewAvailable;
let overviewPortfolio;
function refreshEnvironment(preferences = dialogs.preferences) {
  const available =
    activeProject === "sample" && preferences.marketSource === "demo";
  if (available !== overviewAvailable || preferences.portfolioId !== overviewPortfolio) {
    const portfolio = portfolios.find((item) => item.id === preferences.portfolioId) || portfolios[0];
    $("#overview").innerHTML = overviewContent(available, {}, portfolio);
    overviewAvailable = available;
    overviewPortfolio = portfolio.id;
  }
  updateStatus(preferences, activeProject === "sample");
}
refreshEnvironment();
function toast(text) {
  clearTimeout(toastTimer);
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 2500);
}
function setSidebar(open) {
  $("#projects").hidden = !open;
  app.classList.toggle("sidebar-open", open);
  $("#projectSwitch").setAttribute("aria-expanded", String(open));
  $("#projectSwitch").title = open ? "收起会话侧栏" : "展开会话侧栏";
  if (open) {
    app.classList.remove("mobile-open");
    $("#search").focus();
  } else $("#projectSwitch").focus();
}
function togglePanel() {
  if (innerWidth <= 760) {
    setSidebar(false);
    app.classList.toggle("mobile-open");
  } else app.classList.toggle("no-panel");
}
function renderSessions() {
  const count = renderSessionList($("#sessionList"), {
    sessions,
    activeId: activeProject,
    query: $("#search").value,
    onSelect: selectProject,
    onPin: (id) => {
      const session = sessions.get(id);
      session.pinned = !session.pinned;
      renderSessions();
    },
  });
  $("#noProjects").hidden = count > 0;
  $("#sessionCount").textContent = String(sessions.size);
}
function saveSession() {
  const session = sessions.get(activeProject);
  session.html = thread.querySelector(".empty-state") ? "" : thread.innerHTML;
  session.scroll = stream.scrollTop;
}
function selectProject(id) {
  if (running) {
    toast("请先停止当前演示，再切换会话");
    return;
  }
  if (id === "new") {
    createSession();
    return;
  }
  if (!sessions.has(id)) return;
  saveSession();
  const previous = activeProject;
  activeProject = id;
  window.quantComposer?.switchProject(previous, id);
  const session = sessions.get(id);
  thread.innerHTML = session.html || emptyMarkup();
  $("#ticker").textContent = session.symbol || "新研究";
  $("#projectName").textContent = session.title;
  $("#sessionTitle").textContent = session.title;
  $("#runSummary").textContent = session.status;
  refreshEnvironment();
  if (innerWidth <= 900) setSidebar(false);
  app.classList.remove("mobile-open");
  renderSessions();
  applyViewMode();
  prepareLongMessages(thread);
  stream.scrollTop = session.scroll;
  updateJump();
  input.focus();
}
function createSession() {
  if (running) {
    toast("请先停止当前演示，再新建会话");
    return;
  }
  const id = "local-" + Date.now() + "-" + ++serial;
  sessions.set(id, {
    id,
    title: "新研究",
    symbol: "",
    html: "",
    scroll: 0,
    pinned: false,
    stamp: "刚刚",
    group: "今天",
    status: "等待输入",
    updated: Date.now(),
  });
  selectProject(id);
}
function applyViewMode() {
  $("#viewMode").hidden = !thread.querySelector(".process-disclosure");
  app.classList.toggle("process-mode", detailed);
  $("#viewMode").setAttribute("aria-pressed", String(detailed));
  $("#viewMode").innerHTML = icon(detailed ? "list-collapse" : "list-tree");
  $("#viewMode").setAttribute("aria-label", detailed ? "收起过程" : "展开过程");
  $("#viewMode").title = detailed ? "收起过程" : "展开过程";
  thread
    .querySelectorAll(".process-disclosure")
    .forEach((d) => (d.open = detailed));
  thread
    .querySelectorAll(".process-body .tool")
    .forEach((d) => (d.open = detailed));
}
function updateJump() {
  const far =
    stream.scrollHeight - stream.scrollTop - stream.clientHeight > 110;
  $("#jumpLatest").hidden = !far;
}
function follow(force = false) {
  if (
    force ||
    stream.scrollHeight - stream.scrollTop - stream.clientHeight < 150
  )
    stream.scrollTop = stream.scrollHeight;
  updateJump();
}
function sendDemo(text, references = [], canonical = text) {
  if (thread.querySelector(".empty-state")) thread.replaceChildren();
  const session = sessions.get(activeProject);
  if (session.title === "新研究") {
    session.title = text.replace(/\s+/g, " ").slice(0, 24);
    $("#projectName").textContent = session.title;
    $("#sessionTitle").textContent = session.title;
  }
  session.status = "演示中";
  session.updated = Date.now();
  session.stamp = "刚刚";
  session.group = "今天";
  renderSessions();
  const { turn, process, label, time } = createDemoTurn(
    text,
    references,
    canonical,
    { detailed },
  );
  thread.append(turn);
  $("#viewMode").hidden = false;
  running = true;
  setSendState(true);
  $("#runSummary").textContent = "演示中";
  prepareLongMessages(thread);
  follow(true);
  const timer = setTimeout(() => {
    running = false;
    currentRun = null;
    process.dataset.state = "complete";
    label.classList.remove("run-state");
    label.textContent = "已整理问题与上下文";
    time.textContent = "2 项操作 · 演示";
    const answer = createDemoAnswer();
    const nearBottom =
      stream.scrollHeight - stream.scrollTop - stream.clientHeight < 150;
    turn.append(answer);
    setSendState(false);
    $("#runSummary").textContent = "已完成";
    session.status = "演示完成";
    saveSession();
    renderSessions();
    if (nearBottom) follow(true);
    else updateJump();
  }, 1800);
  currentRun = { timer, process, label, time, session };
  saveSession();
}
function stop() {
  if (!currentRun) return;
  clearTimeout(currentRun.timer);
  const { process, label, time, session } = currentRun;
  process.dataset.state = "stopped";
  label.textContent = "已停止";
  label.classList.remove("run-state");
  time.textContent = "问题和引用已保留";
  running = false;
  currentRun = null;
  session.status = "已停止";
  setSendState(false);
  $("#runSummary").textContent = "已停止";
  saveSession();
  renderSessions();
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制");
  } catch {
    toast("复制不可用，请选择正文手动复制");
  }
}
function renameSession() {
  dialogs.open("rename");
}
$("#viewMode").onclick = () => {
  detailed = !detailed;
  applyViewMode();
  updateJump();
};
$("#sessionTitle").onclick = renameSession;
$("#jumpLatest").onclick = () => follow(true);
stream.addEventListener("scroll", updateJump, { passive: true });
thread.addEventListener("toggle", updateJump, true);
$("#togglePanel").onclick = togglePanel;
$("#shade").onclick = () => {
  setSidebar(false);
  app.classList.remove("mobile-open");
};
$("#projectSwitch").onclick = () => setSidebar($("#projects").hidden);
$("#closeProjects").onclick = () => setSidebar(false);
$("#search").oninput = renderSessions;
$("#newResearch").onclick = $("#newFromMenu").onclick = createSession;

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  if (target.closest("#closePanel")) {
    app.classList.remove("mobile-open");
    if (innerWidth > 760) app.classList.add("no-panel");
  }
  const example = target.closest("[data-example]");
  if (example) {
    window.quantComposer?.setText(example.dataset.example);
    input.focus();
  }
  const button = target.closest("[data-modal]");
  if (button) showModal(button.dataset.modal);
  const expand = target.closest("[data-expand-message]");
  if (expand) {
    const row = expand.closest(".user-message");
    row.classList.toggle("expanded");
    const open = row.classList.contains("expanded");
    expand.innerHTML = icon(open ? "chevron-up" : "chevron-down");
    expand.setAttribute("aria-label", open ? "收起问题" : "展开问题");
    expand.title = open ? "收起问题" : "展开问题";
    expand.setAttribute("aria-expanded", String(open));
  }
  const copy = target.closest("[data-copy]");
  if (copy) {
    const node =
      copy.dataset.copy === "question"
        ? copy.closest(".user-message").querySelector(".question-content")
        : copy.closest(".answer");
    const content = node.cloneNode(true);
    content
      .querySelectorAll(".answer-head,.answer-footer")
      .forEach((n) => n.remove());
    copyText(content.textContent.trim());
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$("#projects").hidden) setSidebar(false);
    window.quantComposer?.close();
    app.classList.remove("mobile-open");
  }
});
new ResizeObserver(() => {
  prepareLongMessages(thread);
  updateJump();
}).observe(stream);
window.quantPrototype = {
  showModal,
  selectProject,
  send: sendDemo,
  stop,
  isRunning: () => running,
  openProjects: () => setSidebar(true),
  getSessions: () =>
    [...sessions.values()].map((s) => ({
      id:
        s.id === "sample"
          ? "demo-session-drawdown"
          : s.id === "empty"
            ? "demo-session-tracking"
            : s.id,
      label: s.title,
      project: s.id,
      description: (s.symbol || "本地会话") + " · " + s.status,
      kind: "session",
      group: "历史研究",
      category: "sessions",
    })),
};
renderSessions();
applyViewMode();
prepareLongMessages(thread);
updateJump();
setSendState(false);

function showModal(kind) {
  dialogs.open(kind);
}
