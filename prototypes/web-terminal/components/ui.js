/** Shared presentation primitives. Text/attributes are escaped; content is trusted component markup. */
export function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

export function icon(name) {
  return `<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="assets/lucide.svg#${escapeHtml(name)}"></use></svg>`;
}

export function iconButton({
  name,
  label,
  id = "",
  className = "",
  type = "button",
  attrs = {},
}) {
  const extra = Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
    .join(" ");
  return `<button ${id ? `id="${escapeHtml(id)}"` : ""} type="${type}" class="icon-button ${escapeHtml(className)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" ${extra}>${icon(name)}</button>`;
}

export function setIconButton(button, { name, label }) {
  button.innerHTML = icon(name);
  button.setAttribute("aria-label", label);
  button.title = label;
}

export function panelHeader({ title, iconName = "", actions = "" }) {
  return `<div class="section-label" data-component="PanelHeader"><span class="panel-title">${iconName ? icon(iconName) : ""}${escapeHtml(title)}</span><div class="panel-actions">${actions}</div></div>`;
}

export function section({ id, title, description = "", content }) {
  return `<div class="modal-section" data-component="Section" aria-labelledby="${id}-title"><div class="modal-section-header"><h3 id="${id}-title">${escapeHtml(title)}</h3>${description ? `<p>${escapeHtml(description)}</p>` : ""}</div><div class="modal-section-body">${content}</div></div>`;
}

export function fieldRow({
  label,
  description = "",
  control = "",
  forId = "",
  status = "",
}) {
  return `<div class="field-row" data-component="FieldRow"><div class="field-copy">${forId ? `<label for="${forId}">${escapeHtml(label)}</label>` : `<span class="field-label">${escapeHtml(label)}</span>`}${description ? `<p>${escapeHtml(description)}</p>` : ""}</div><div class="field-control">${control || `<span class="field-status">${escapeHtml(status)}</span>`}</div></div>`;
}

export function actionButton({ id, label, iconName = "", primary = false }) {
  return `<button type="button" id="${id}" class="action-button${primary ? " primary" : ""}">${iconName ? icon(iconName) : ""}<span>${escapeHtml(label)}</span></button>`;
}
