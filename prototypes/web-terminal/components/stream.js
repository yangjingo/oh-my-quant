import { icon, iconButton } from "./ui.js";
import { demoTurn } from "../data/demo-turn.js";

export function createDemoTurn(
  text,
  references,
  canonical,
  { detailed = false } = {},
) {
  const turn = document.createElement("section");
  turn.className = "conversation-turn";
  turn.dataset.component = "ConversationTurn";
  turn.append(userMessage(text, references, canonical));
  const process = document.createElement("details");
  process.className = "process-disclosure";
  process.dataset.state = "running";
  process.dataset.component = "ProcessDisclosure";
  process.open = detailed;
  const summary = document.createElement("summary");
  const label = document.createElement("span");
  label.className = "process-title run-state";
  label.textContent = "正在整理问题";
  const time = document.createElement("span");
  time.className = "process-time";
  time.textContent = "本地演示";
  summary.append(label, time);
  const body = document.createElement("div");
  body.className = "process-body";
  body.innerHTML =
    '<div class="tool"><span>● 整理输入</span><pre>└ 已保留问题与所选引用\n  未向外部发送数据</pre></div><div class="tool"><span>○ 模型连接</span><pre>└ 未连接 · 本轮不会执行行情或模型调用</pre></div>';
  process.append(summary, body);
  turn.append(process);
  return { turn, process, label, time };
}

export function createDemoAnswer() {
  const answer = document.createElement("article");
  answer.className = "answer";
  answer.dataset.component = "AssistantAnswer";
  answer.innerHTML = `<div class="answer-head"><img src="assets/logo-mark.svg" alt="">WhyJ</div><p>问题和引用已保留。这是本地交互预览，尚未连接模型与数据源；连接后，回答、证据和结果会在这一会话中继续展开。</p><div class="answer-footer">${iconButton({ name: "copy", label: "复制回答", className: "copy-answer", attrs: { "data-copy": "answer" } })}<span class="reply-time">演示完成</span></div>`;
  return answer;
}

export function renderSessionPanel() {
  return /* html */ `<main class="research" data-component="SessionPanel"><div class="section-label"><span class="session-heading"><span class="dot">◉</span><button class="session-title-button" id="sessionTitle" title="重命名会话">回撤结构研究</button></span><div class="session-controls"><span id="runSummary">已完成</span>${iconButton({ name: "list-tree", label: "展开过程", id: "viewMode", className: "quiet-control", type: "button", attrs: { "aria-pressed": "false" } })}</div></div><div aria-label="研究会话" class="stream" id="stream" tabindex="0"><div class="thread-inner" id="thread">${demoTurn}</div></div>${iconButton({ name: "arrow-down", label: "回到最新", id: "jumpLatest", className: "jump-latest", type: "button", attrs: { hidden: "" } })}</main>`;
}

export function emptyMarkup() {
  return '<div class="empty-state"><div class="eyebrow">JQ / RESEARCH</div><h1>从一个问题，开始研究。</h1><p>输入研究对象和判断。用 <span class="gold">/</span> 选择命令，<span class="gold">@</span> 引用上下文。</p><div class="empty-examples"><button data-example="最近一个月，中际旭创相对沪深300表现如何？">› 相对沪深300，最近的表现如何？</button><button data-example="这次回撤有哪些证据，哪些信息还缺失？">› 核对这次回撤的证据与判断边界</button></div><p><small>本地交互预览 · 模型与数据源未连接</small></p></div>';
}

export function prepareLongMessages(thread) {
  thread.querySelectorAll(".user-message").forEach((row) => {
    const content = row.querySelector(".question-content");
    if (!content) return;
    row.classList.remove("is-long");
    const long = content.scrollHeight > 121;
    row.classList.toggle("is-long", long);
    let button = row.querySelector(".user-expand");
    if (long && !button) {
      button = document.createElement("button");
      button.className = "user-expand icon-button";
      button.dataset.expandMessage = "";
      button.innerHTML = icon("chevron-down");
      button.setAttribute("aria-label", "展开问题");
      button.title = "展开问题";
      button.setAttribute("aria-expanded", "false");
      row.append(button);
    }
    if (button) button.hidden = !long;
  });
}
export function userMessage(text, references, canonical) {
  const row = document.createElement("div");
  row.className = "user-message";
  const q = document.createElement("div");
  q.className = "question";
  const mark = document.createElement("span");
  mark.className = "prompt";
  mark.textContent = "›";
  const content = document.createElement("span");
  content.className = "question-content";
  content.textContent = text;
  q.append(mark, content);
  row.append(q);
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const time = document.createElement("span");
  time.textContent =
    "你 · " +
    new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Shanghai",
    });
  const copy = document.createElement("button");
  copy.className = "message-copy";
  copy.dataset.copy = "question";
  copy.innerHTML = icon("copy");
  copy.setAttribute("aria-label", "复制问题");
  copy.title = "复制问题";
  meta.append(time, copy);
  row.append(meta);
  if (references.length) {
    const details = document.createElement("details");
    details.className = "submitted-refs";
    const summary = document.createElement("summary");
    summary.textContent = references.length + " 个引用 · 示例";
    const pre = document.createElement("pre");
    pre.textContent =
      references
        .map(
          (r) =>
            (r.kind === "session" ? "研究" : "文件") +
            " · " +
            r.label +
            "\n  " +
            (r.path || r.id),
        )
        .join("\n") +
      "\n\n提交内容（预览）\n" +
      canonical;
    details.append(summary, pre);
    row.append(details);
  }
  return row;
}
