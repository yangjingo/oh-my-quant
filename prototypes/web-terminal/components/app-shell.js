import { renderHeader } from "./header.js";
import { renderSidebar } from "./sidebar.js";
import { renderSessionPanel } from "./stream.js";
import { renderOverview } from "./overview.js";
import { renderComposer } from "./composer.js";
import { renderStatus } from "./status.js";
import { renderModalShell } from "./modal.js";

export function mountApp(root) {
  root.innerHTML = `<div class="app" id="app" data-component="AppShell">
    ${renderHeader()}
    <div class="workspace" data-component="Workspace">${renderSidebar()}${renderSessionPanel()}${renderOverview()}</div>
    ${renderComposer()}
    ${renderStatus()}
  </div><div class="drawer-shade" id="shade"></div>${renderModalShell()}`;
}
