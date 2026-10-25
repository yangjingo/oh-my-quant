import { version } from "./data/brand.js";
import { commands } from "./data/commands.js";
import { files, fallbackSessions } from "./data/references.js";
import {
  detect,
  score,
  replaceToken,
  remapRefs,
  serialize,
} from "./composer-core.mjs";

const $ = (s) => document.querySelector(s);
const input = $("#input"),
  form = $("#composer"),
  panel = $("#cmdMenu"),
  list = $("#suggestionList");
const bridge = window.quantPrototype;
// Names are aligned with oh-my-quant's command-catalog.ts, not a second CLI vocabulary.
const sessionCatalog = () => bridge.getSessions?.() || fallbackSessions;
let refs = [],
  previous = "",
  active = null,
  items = [],
  selected = 0,
  composing = false,
  compositionUntil = 0,
  dismissed = "",
  category = "all";
let history = [],
  future = [],
  selection = { start: 0, end: 0 },
  feedbackTimer;
const projectDrafts = new Map();
function snapshot() {
  return {
    text: input.value,
    refs: refs.map((r) => ({ ...r })),
    caret: input.selectionStart,
  };
}
function remember() {
  history.push(snapshot());
  if (history.length > 60) history.shift();
  future = [];
}
function announce(message) {
  $("#composerLive").textContent = message;
}
function feedback(message) {
  close();
  $("#composerFeedback").textContent = message;
  $("#composerFeedback").hidden = false;
  announce(message);
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(
    () => ($("#composerFeedback").hidden = true),
    6000,
  );
}
function hideFeedback() {
  clearTimeout(feedbackTimer);
  $("#composerFeedback").hidden = true;
}
function sync() {
  const mirror = $("#inputMirror");
  mirror.replaceChildren();
  let offset = 0;
  for (const r of [...refs].sort((a, b) => a.start - b.start)) {
    mirror.append(document.createTextNode(input.value.slice(offset, r.start)));
    const mark = document.createElement("mark");
    mark.textContent = input.value.slice(r.start, r.end);
    mirror.append(mark);
    offset = r.end;
  }
  mirror.append(document.createTextNode(input.value.slice(offset) + "\u200b"));
  input.style.height = "37px";
  input.style.height = Math.min(input.scrollHeight, 110) + "px";
  mirror.scrollTop = input.scrollTop;
  previous = input.value;
  selection = { start: input.selectionStart, end: input.selectionEnd };
}
function restore(state) {
  input.value = state.text;
  refs = state.refs.map((r) => ({ ...r }));
  input.setSelectionRange(state.caret, state.caret);
  sync();
  close();
  input.focus();
}
function close() {
  panel.hidden = true;
  active = null;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
}
function currentTrigger() {
  if (input.selectionStart !== input.selectionEnd) return null;
  const detected = detect(input.value, input.selectionStart, refs);
  if (detected) return detected;
  // CLI subcommands remain part of a single command expression.
  const head = input.value
    .slice(0, input.selectionStart)
    .match(/^\/(portfolio|skill|doctor) ([a-z-]*)$/);
  return head
    ? {
        trigger: "/",
        query: head[1] + " " + head[2],
        start: 0,
        end: input.selectionStart,
        subcommand: head[1],
      }
    : null;
}
const subcommands = {
  portfolio: [
    ["list", "列出观察组"],
    ["create", "创建观察组 · 后接名称"],
    ["add", "添加标的 · 后接组合和代码"],
  ],
  skill: [
    ["list", "列出技能"],
    ["info", "查看技能 · 后接名称"],
    ["run", "运行技能 · 后接名称与问题"],
  ],
  doctor: [
    ["--phase data", "检查行情连接"],
    ["--phase model", "检查模型连接"],
    ["--phase tools", "检查工具连接"],
  ],
};
function candidates(token) {
  if (token.trigger === "/") {
    const source = token.subcommand
      ? subcommands[token.subcommand].map(([suffix, description]) => ({
          id: token.subcommand + " " + suffix,
          name: token.subcommand + " " + suffix,
          label: "/" + token.subcommand + " " + suffix,
          description,
          group: "子命令",
          kind: "command",
          action: "host",
        }))
      : commands;
    return source
      .map((item) => ({
        item,
        rank: Math.min(
          score(item.name, token.query),
          score(item.description, token.query) + 100,
        ),
      }))
      .filter((x) => Number.isFinite(x.rank))
      .sort((a, b) => a.rank - b.rank)
      .map((x) => x.item);
  }
  let source = [...files, ...sessionCatalog()];
  if (category !== "all")
    source = source.filter((x) => x.category === category);
  if (token.quoted) source = source.filter((x) => x.category === "files");
  if (!token.query)
    source = source.filter(
      (x) => !x.path || !x.path.replace(/\/$/, "").includes("/"),
    );
  if (token.query.endsWith("/"))
    source = source.filter(
      (x) =>
        x.path?.startsWith(token.query) &&
        x.path !== token.query &&
        !x.path.slice(token.query.length).replace(/\/$/, "").includes("/"),
    );
  return source
    .map((item) => ({
      item,
      rank: Math.min(
        score(item.path || item.label, token.query),
        score(item.description, token.query) + 100,
      ),
    }))
    .filter((x) => Number.isFinite(x.rank))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.item);
}
function render() {
  list.replaceChildren();
  const grouped = new Map();
  items.forEach((item) => {
    if (!grouped.has(item.group)) grouped.set(item.group, []);
    grouped.get(item.group).push(item);
  });
  items = [...grouped.values()].flat();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "suggestion-empty";
    empty.textContent = "没有匹配项。继续输入关键词，或 Esc 返回正文。";
    list.append(empty);
  }
  for (const [group, entries] of grouped) {
    const section = document.createElement("div");
    section.setAttribute("role", "group");
    section.setAttribute("aria-label", group);
    const heading = document.createElement("div");
    heading.className = "suggestion-group";
    heading.textContent = group + " / " + entries.length;
    section.append(heading);
    for (const item of entries) {
      const i = items.indexOf(item),
        row = document.createElement("button");
      row.type = "button";
      row.tabIndex = -1;
      row.id = "suggestion-" + i;
      row.className = "suggestion-option";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(i === selected));
      const icon = document.createElement("span");
      icon.className = "suggestion-icon";
      icon.textContent =
        item.kind === "command"
          ? "/"
          : item.kind === "directory"
            ? "▸"
            : item.kind === "session"
              ? "◷"
              : "▤";
      icon.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      copy.className = "suggestion-copy";
      const label = document.createElement("span");
      label.className = "suggestion-label";
      label.textContent = item.label;
      const desc = document.createElement("span");
      desc.className = "suggestion-description";
      desc.textContent = item.description;
      copy.append(label, desc);
      const tag = document.createElement("span");
      tag.className = "suggestion-tag";
      tag.textContent =
        item.kind === "directory"
          ? "进入 ›"
          : item.kind === "command"
            ? item.action === "host"
              ? "需连接"
              : "可用"
            : "引用 ↵";
      row.append(icon, copy, tag);
      row.onpointerdown = (e) => e.preventDefault();
      row.onclick = () => pick(i);
      row.onpointermove = () => highlight(i, false);
      section.append(row);
    }
    list.append(section);
  }
  highlight(selected, false);
}
function highlight(index, scroll = true) {
  selected = index;
  list
    .querySelectorAll("[role=option]")
    .forEach((r, i) => r.setAttribute("aria-selected", String(i === index)));
  if (items[index]) {
    input.setAttribute("aria-activedescendant", "suggestion-" + index);
    if (scroll) $("#suggestion-" + index)?.scrollIntoView({ block: "nearest" });
  } else input.removeAttribute("aria-activedescendant");
}
function update(force = false) {
  sync();
  if (composing) return;
  const next = currentTrigger();
  const signature = next ? JSON.stringify(next) : "";
  if (!next || (!force && signature === dismissed)) {
    close();
    return;
  }
  hideFeedback();
  const changed =
    !active || active.trigger !== next.trigger || active.query !== next.query;
  if (active?.trigger !== next.trigger) category = "all";
  active = next;
  items = candidates(active);
  if (changed) selected = 0;
  selected = Math.min(selected, Math.max(0, items.length - 1));
  $("#suggestionSymbol").textContent = active.trigger;
  $("#suggestionTitle").textContent =
    active.trigger === "/" ? "命令" : "引用上下文";
  $("#suggestionScope").textContent =
    active.trigger === "/"
      ? `oh-my-quant · v${version}`
      : "示例工作区 · 未连接文件服务";
  $("#suggestionTabs").hidden = active.trigger !== "@";
  document
    .querySelectorAll("[data-category]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.category === category)),
    );
  $("#suggestionAction").textContent =
    active.trigger === "/" ? "补全后 Enter 执行" : "选中后继续提问";
  panel.hidden = false;
  input.setAttribute("aria-expanded", "true");
  render();
  announce(items.length + " 个候选，方向键选择，Enter 或 Tab 确认");
}
function applyEdit(start, end, insert, reference) {
  remember();
  const before = input.value,
    next = before.slice(0, start) + insert + before.slice(end);
  refs = remapRefs(before, next, refs);
  input.value = next;
  if (reference)
    refs.push({ ...reference, start, end: start + reference.token.length });
  input.setSelectionRange(start + insert.length, start + insert.length);
  dismissed = "";
  sync();
  input.focus();
}
function pick(index) {
  const item = items[index],
    token = active;
  if (!item || !token) return;
  let fill, reference;
  if (item.kind === "command") fill = "/" + item.name;
  else if (item.kind === "directory")
    fill = "@" + (/\s/.test(item.path) ? '"' : "") + item.path;
  else if (item.kind === "file") {
    fill = "@" + (/\s/.test(item.path) ? '"' + item.path + '"' : item.path);
    reference = {
      id: item.id,
      kind: item.kind,
      label: item.label,
      path: item.path,
      token: fill,
      canonical: fill,
    };
  } else {
    fill = "@" + item.label;
    reference = {
      id: item.id,
      kind: item.kind,
      label: item.label,
      token: fill,
      canonical: "@[" + item.label + "](quant-session:" + item.id + ")",
    };
  }
  const edit = replaceToken(
    input.value,
    token,
    fill,
    item.kind === "directory",
  );
  applyEdit(edit.start, edit.end, edit.insert, reference);
  if (item.kind === "directory") update(true);
  else {
    close();
    announce(
      item.kind === "command"
        ? "已补全，Enter 执行"
        : "已添加引用 " + item.label,
    );
  }
}
document.querySelectorAll("[data-category]").forEach((b) => {
  b.onpointerdown = (e) => e.preventDefault();
  b.onclick = () => {
    category = b.dataset.category;
    selected = 0;
    update(true);
    input.focus();
  };
});
input.addEventListener("beforeinput", (e) => {
  if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
    e.preventDefault();
    undo(e.inputType === "historyRedo");
    return;
  }
  if (!composing) remember();
});
input.addEventListener("input", () => {
  refs = remapRefs(previous, input.value, refs);
  dismissed = "";
  update();
});
input.addEventListener("compositionstart", () => {
  remember();
  composing = true;
  close();
});
input.addEventListener("compositionend", () => {
  composing = false;
  compositionUntil = performance.now() + 80;
  refs = remapRefs(previous, input.value, refs);
  update(true);
});
input.addEventListener("scroll", () => {
  $("#inputMirror").scrollTop = input.scrollTop;
});
input.addEventListener("click", () => update(true));
input.addEventListener("select", () => {
  selection = { start: input.selectionStart, end: input.selectionEnd };
});
function undo(redo = false) {
  const from = redo ? future : history,
    to = redo ? history : future;
  if (!from.length) return;
  to.push(snapshot());
  restore(from.pop());
}
input.addEventListener("keydown", (e) => {
  if (
    e.isComposing ||
    composing ||
    e.keyCode === 229 ||
    performance.now() < compositionUntil
  )
    return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undo(e.shiftKey);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    undo(true);
    return;
  }
  if (e.key === "Escape" && (!panel.hidden || !$("#composerFeedback").hidden)) {
    e.preventDefault();
    e.stopPropagation();
    dismissed = JSON.stringify(currentTrigger());
    close();
    hideFeedback();
    return;
  }
  if (!panel.hidden && !e.shiftKey) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length)
        highlight(
          (selected + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length,
        );
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (!e.repeat && items.length) pick(selected);
      return;
    }
  }
  if (
    (e.key === "Backspace" || e.key === "Delete") &&
    input.selectionStart === input.selectionEnd
  ) {
    const at = input.selectionStart,
      ref = refs.find((r) =>
        e.key === "Backspace"
          ? at > r.start && at <= r.end
          : at >= r.start && at < r.end,
      );
    if (ref) {
      e.preventDefault();
      applyEdit(ref.start, ref.end, "");
      close();
      return;
    }
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!e.repeat) form.requestSubmit();
  }
});
input.addEventListener("keyup", (e) => {
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) update();
});
input.addEventListener("copy", (e) => {
  const start = input.selectionStart,
    end = input.selectionEnd;
  if (start === end) return;
  const selectedRefs = refs
    .filter((r) => r.start >= start && r.end <= end)
    .map((r) => ({ ...r, start: r.start - start, end: r.end - start }));
  e.clipboardData.setData(
    "text/plain",
    serialize(input.value.slice(start, end), selectedRefs),
  );
  e.preventDefault();
});
input.addEventListener("paste", (e) => {
  const text = e.clipboardData.getData("text/plain");
  e.preventDefault();
  let parsed = "",
    found = [],
    end = 0;
  const pattern =
    /@\[([^\]\n]+)\]\(quant-session:([^\s)]+)\)|@"([^"\n]+)"|@([^\s]+)/g;
  for (const m of text.matchAll(pattern)) {
    const item = m[2]
      ? sessionCatalog().find((x) => x.id === m[2])
      : files.find((x) => x.kind === "file" && x.path === (m[3] || m[4]));
    if (!item) continue;
    parsed += text.slice(end, m.index);
    const token = item.kind === "session" ? "@" + item.label : m[0];
    found.push({
      id: item.id,
      kind: item.kind,
      label: item.label,
      path: item.path,
      start: parsed.length,
      end: parsed.length + token.length,
      token,
      canonical:
        item.kind === "session"
          ? "@[" + item.label + "](quant-session:" + item.id + ")"
          : token,
    });
    parsed += token;
    end = m.index + m[0].length;
  }
  parsed += text.slice(end);
  const start = input.selectionStart;
  applyEdit(start, input.selectionEnd, parsed);
  refs.push(
    ...found.map((r) => ({ ...r, start: r.start + start, end: r.end + start })),
  );
  sync();
  update();
});
document.addEventListener("pointerdown", (e) => {
  if (!form.contains(e.target)) close();
});
input.addEventListener("blur", () => {
  setTimeout(() => {
    if (!form.contains(document.activeElement)) close();
  }, 0);
});
function clear() {
  input.value = "";
  refs = [];
  history = [];
  future = [];
  dismissed = "";
  sync();
  close();
  hideFeedback();
}
form.onsubmit = (e) => {
  e.preventDefault();
  if (composing || performance.now() < compositionUntil) return;
  if (bridge.isRunning()) {
    bridge.stop();
    return;
  }
  const text = input.value.trim();
  if (!text) return;
  if (text.startsWith("/")) {
    const [name, ...args] = text.slice(1).split(/\s+/);
    const command = commands.find((c) => c.name === name);
    if (!command) {
      feedback("未知命令 /" + name + "。输入 / 搜索命令；草稿已保留。");
      return;
    }
    if (command.action === "host" || args.length) {
      feedback("此命令需要真实运行服务，当前仅演示补全。输入已保留。");
      return;
    }
    if (command.action === "clear") {
      clear();
      bridge.selectProject("new");
      return;
    }
    if (command.action === "resume") {
      clear();
      bridge.openProjects();
      return;
    }
    clear();
    if (command.action === "help") showHelp();
    else bridge.showModal(command.action);
    return;
  }
  const dangling = /@\[[^\]]+\]\(quant-session:[^)]+\)/.test(input.value);
  if (dangling) {
    feedback(
      "这条研究引用无法在示例工作区解析。请通过 @ 重新选择，草稿已保留。",
    );
    return;
  }
  let canonical;
  try {
    canonical = serialize(input.value, refs);
  } catch (error) {
    feedback(error.message);
    return;
  }
  bridge.send(
    input.value.trim(),
    refs.map((r) => ({ ...r })),
    canonical,
  );
  clear();
};
function showHelp() {
  bridge.showModal("commands");
}
window.quantComposer = {
  switchProject(from, to) {
    projectDrafts.set(from, {
      ...snapshot(),
      history: [...history],
      future: [...future],
    });
    const saved = projectDrafts.get(to) || {
      text: "",
      refs: [],
      caret: 0,
      history: [],
      future: [],
    };
    restore(saved);
    history = [...saved.history];
    future = [...saved.future];
    hideFeedback();
  },
  setText(text) {
    remember();
    input.value = text;
    refs = [];
    input.setSelectionRange(text.length, text.length);
    sync();
    close();
  },
  close,
  showHelp,
};
sync();
