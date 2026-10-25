import { icon, iconButton } from "./ui.js";

export function renderSidebar() {
  return /* html */ `<aside aria-label="研究会话侧栏" class="project-rail" data-component="Sidebar" hidden="" id="projects"><div class="section-label"><span>Sessions <span class="session-count" id="sessionCount">2</span></span>${iconButton({ name: "panel-left-close", label: "收起会话侧栏", id: "closeProjects", className: "quiet-control", type: "button" })}</div><div class="rail-body"><input aria-label="搜索会话" class="rail-search" id="search" placeholder="搜索会话…"/><button class="rail-new" id="newFromMenu">${icon("square-pen")}新会话</button><nav aria-label="研究会话列表" id="sessionList"></nav><p class="rail-label" hidden="" id="noProjects">没有匹配的会话</p></div><div class="rail-footer">oh-my-quant / 本地预览</div></aside>`;
}

export function renderSessionList(
  target,
  { sessions, activeId, query, onSelect, onPin },
) {
  target.replaceChildren();
  query = query.trim().toLowerCase();
  const matches = [...sessions.values()]
    .filter((s) => (s.title + " " + s.symbol).toLowerCase().includes(query))
    .sort((a, b) => b.updated - a.updated);
  for (const label of ["置顶", "今天", "更早"]) {
    const entries = matches.filter((s) =>
      s.pinned ? label === "置顶" : s.group === label,
    );
    if (!entries.length) continue;
    const h = document.createElement("h3");
    h.className = "session-group-label";
    h.textContent = label;
    target.append(h);
    for (const session of entries) {
      const row = document.createElement("div");
      row.className =
        "session-row" + (session.id === activeId ? " active" : "");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "session-entry";
      button.dataset.project = session.id;
      button.title = session.title + " · " + session.symbol;
      button.setAttribute(
        "aria-current",
        session.id === activeId ? "page" : "false",
      );
      button.onclick = () => onSelect(session.id);
      const line = document.createElement("span");
      line.className = "session-line";
      const title = document.createElement("span");
      title.className = "session-title";
      title.textContent = session.title;
      const time = document.createElement("span");
      time.className = "session-time";
      time.textContent = session.stamp;
      line.append(title, time);
      const meta = document.createElement("small");
      meta.textContent =
        (session.symbol || "研究会话") + " · " + session.status;
      button.append(line, meta);
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "session-pin";
      pin.innerHTML = icon(session.pinned ? "pin-off" : "pin");
      pin.title = session.pinned ? "取消置顶" : "置顶";
      pin.setAttribute("aria-pressed", String(session.pinned));
      pin.setAttribute(
        "aria-label",
        (session.pinned ? "取消置顶 " : "置顶 ") + session.title,
      );
      pin.onclick = () => onPin(session.id);
      row.append(button, pin);
      target.append(row);
    }
  }
  return matches.length;
}
