import { mountWorkbench } from "./mount";
import { createDisconnectedClient } from "./client/disconnected";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

/**
 * Entry selection lives here and only here. The Electron build and the Host
 * served build supply a client through mountWorkbench. The standalone default
 * reports an unavailable Host. Only the explicit demo build loads fixtures.
 */
if (import.meta.env.MODE === "demo") {
  const { createDemoClient } = await import("../dev/demo-client");
  let storage: Storage | undefined;
  try { storage = window.localStorage; } catch { /* Browser storage is optional. */ }
  mountWorkbench(container, createDemoClient({ storage }));
} else {
  mountWorkbench(container, createDisconnectedClient());
}
