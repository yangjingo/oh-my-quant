import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Workbench } from "./Workbench";
import type { WorkbenchClient } from "./client/contract";
import "./styles/app.css";

/** Integration seam for the browser/renderer bootstrap; unmount only releases subscriptions. */
export function mountWorkbench(container: HTMLElement, client: WorkbenchClient) {
  const root = createRoot(container);
  root.render(<StrictMode><Workbench client={client} /></StrictMode>);
  return () => root.unmount();
}
