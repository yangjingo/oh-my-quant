// Enhance the original Markdown tables; never maintain a second data source.
const dialog = document.createElement("dialog");
dialog.className = "table-dialog";
dialog.setAttribute("aria-label", "展开阅读表格");
const close = document.createElement("button");
close.type = "button";
close.className = "quiet-icon";
close.setAttribute("aria-label", "返回正文"); close.title = "返回正文";
close.append(blogIcon("x"));
dialog.append(close);
document.body.append(dialog);
let home, expanded, opener;
close.addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  home.replaceWith(expanded);
  opener.hidden = false;
  opener.focus({ preventScroll: true });
});
window.addEventListener("beforeprint", () => { if (dialog.open) dialog.close(); });

document.querySelectorAll(".interactive-table").forEach(component => {
  const toolbar = component.querySelector(".table-tools");
  const panel = component.querySelector(".table-settings");
  const search = panel.querySelector("input");
  const settings = toolbar.querySelector("[data-settings]");
  const select = toolbar.querySelector("[data-select]");
  const status = component.querySelector(".table-state");
  const compare = component.querySelector("[data-compare]");
  const cancel = component.querySelector("[data-cancel]");
  const table = component.querySelector("table");
  const heading = table.tHead.rows[0];
  const headers = [...heading.cells];
  const titles = headers.map(cell => cell.textContent.trim());
  const rows = [...table.tBodies[0].rows];
  const cells = rows.map(row => [...row.cells]);
  const visible = titles.map(() => true);
  const selected = new Set();
  let comparing = false, selecting = false;
  const choices = panel.querySelector(".column-options");
  settings.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    settings.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) search.focus();
  });
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { panel.hidden = true; settings.setAttribute("aria-expanded", "false"); settings.focus(); }
  });
  const selectionHeading = document.createElement("th");
  selectionHeading.textContent = "选择";
  selectionHeading.scope = "col";
  selectionHeading.className = "row-selection";
  heading.prepend(selectionHeading);
  headers.forEach(header => { header.scope = "col"; });
  const inputs = [], toggles = [];
  titles.forEach((title, index) => {
    const option = document.createElement("div"); option.className = "column-option";
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox"; checkbox.checked = true; checkbox.dataset.columnVisibility = index;
    checkbox.setAttribute("aria-label", `显示列：${title}`);
    label.append(checkbox, document.createTextNode(title));
    const input = document.createElement("input");
    input.type = "search"; input.placeholder = "筛选此列"; input.dataset.column = index;
    input.setAttribute("aria-label", `筛选：${title}`); input.setAttribute("aria-controls", table.id);
    option.append(label, input); choices.append(option);
    inputs.push(input); toggles.push(checkbox);
    input.addEventListener("input", render);
    checkbox.addEventListener("change", () => {
      visible[index] = checkbox.checked;
      if (!checkbox.checked) input.value = "";
      render();
    });
  });
  const selections = rows.map((row, index) => {
    const cell = document.createElement("td");
    cell.className = "row-selection";
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("aria-label", `选择对比：${cells[index][0].textContent.trim().slice(0, 80)}`);
    label.append(input); cell.append(label); row.prepend(cell);
    input.addEventListener("change", () => { input.checked ? selected.add(index) : selected.delete(index); render(); });
    return input;
  });
  const comparison = document.createElement("div");
  comparison.className = "comparison-view table-scroll";
  comparison.tabIndex = 0;
  comparison.setAttribute("role", "region");
  comparison.setAttribute("aria-label", "所选项目并排对比，可横向滚动");
  component.querySelector(".table-scroll").after(comparison);
  const originalScroller = table.parentElement;
  const cloneContent = (target, source) => target.append(...[...source.childNodes].map(node => node.cloneNode(true)));
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    headers.forEach((header, i) => {
      header.hidden = !visible[i];
      inputs[i].disabled = comparing || !visible[i];
      cells.forEach(row => { row[i].hidden = !visible[i]; });
      toggles[i].disabled = visible[i] && visible.filter(Boolean).length === 1;
    });
    rows.forEach((row, index) => {
      const content = cells[index].filter((_, i) => visible[i]).map(cell => cell.textContent.toLocaleLowerCase());
      row.hidden = !content.join(" ").includes(query) || inputs.some((input, i) => visible[i] && !cells[index][i].textContent.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase()));
    });
    selectionHeading.hidden = !selecting || comparing;
    selections.forEach(input => { input.closest("td").hidden = !selecting || comparing; });
    const count = rows.filter(row => !row.hidden).length;
    const changed = Boolean(query) || inputs.some(input => input.value) || visible.some(value => !value);
    status.hidden = !changed && !selecting;
    settings.classList.toggle("is-active", changed);
    select.setAttribute("aria-pressed", String(selecting));
    status.querySelector("output").textContent = comparing ? `对比 ${selected.size} 项 · ${visible.filter(Boolean).length} 列` : `${count} / ${rows.length} 行${selecting ? ` · 已选 ${selected.size} 项（全部已选参与对比）` : ""}${visible.some(v => !v) ? ` · ${visible.filter(Boolean).length} / ${titles.length} 列` : ""}`;
    component.querySelector(".table-empty").hidden = comparing || count !== 0;
    compare.hidden = !selecting; cancel.hidden = !selecting;
    compare.disabled = !comparing && selected.size < 2;
    compare.textContent = comparing ? "返回完整表" : `对比所选（${selected.size}）`;
    compare.setAttribute("aria-pressed", String(comparing));
    search.disabled = comparing;
    originalScroller.hidden = comparing;
    comparison.hidden = !comparing;
    component.classList.toggle("is-comparing", comparing);
    if (comparing) {
      const compared = document.createElement("table");
      const caption = document.createElement("caption");
      caption.textContent = "所选项目并排对比（保留当前显示列）";
      compared.append(caption);
      const head = compared.createTHead().insertRow();
      const attribute = document.createElement("th"); attribute.scope = "col"; attribute.textContent = "属性"; head.append(attribute);
      [...selected].forEach(index => { const header = document.createElement("th"); header.scope = "col"; cloneContent(header, cells[index][0]); head.append(header); });
      const body = compared.createTBody();
      titles.forEach((title, i) => {
        if (!visible[i]) return;
        const row = body.insertRow();
        const name = document.createElement("th"); name.scope = "row"; name.textContent = title; row.append(name);
        [...selected].forEach(index => cloneContent(row.insertCell(), cells[index][i]));
      });
      comparison.replaceChildren(compared);
    }
  }
  function endSelection() {
    selecting = false; comparing = false; selected.clear(); selections.forEach(input => { input.checked = false; }); render(); select.focus();
  }
  select.addEventListener("click", () => { if (selecting) endSelection(); else { selecting = true; render(); } });
  cancel.addEventListener("click", endSelection);
  compare.addEventListener("click", () => { comparing = !comparing; render(); });
  search.addEventListener("input", render);
  panel.querySelector("[data-reset]").addEventListener("click", () => {
    search.value = ""; inputs.forEach(input => { input.value = ""; });
    visible.fill(true); toggles.forEach(toggle => { toggle.checked = true; });
    selections.forEach(input => { input.checked = false; }); selected.clear(); comparing = false; selecting = false;
    render(); search.focus();
  });
  const expand = toolbar.querySelector("[data-expand]");
  expand.addEventListener("click", () => {
    home = document.createComment("table position"); expanded = component; opener = expand;
    component.replaceWith(home); expand.hidden = true; dialog.append(component); dialog.showModal();
  });
  toolbar.hidden = false;
  render();
});
