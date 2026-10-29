import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, screen, session, shell, Tray } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { HostConnection } from "../../../src/app/bootstrap.ts";

// Only the local development parent owns this IPC channel; renderer IPC is unchanged.
if (process.env.WHYJ_DESKTOP_DEV_CONTROL === "1" && process.connected) {
  process.on("message", value => { if (value && typeof value === "object" && "type" in value && value.type === "whyj-development-quit") app.quit(); });
  process.on("disconnect", () => app.quit());
}

const recoveryUrl = "app://desktop/recovery.html";
const workbenchUrl = "app://desktop/";
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setPath("userData", process.env.WHYJ_DESKTOP_HOME || join(app.getPath("appData"), "WhyJ Quant"));
const stateDir = app.getPath("userData"), workspace = join(stateDir, "workspace");
const runtime = app.isPackaged ? join(process.resourcesPath, "runtime") : join(app.getAppPath(), "runtime");
const desktopStorage = {
  OHQUANT_DIR: join(workspace, ".ohquant"),
};
const workspaceRoot = resolve(process.env.OHQUANT_DIR || desktopStorage.OHQUANT_DIR);
let window: BrowserWindow | undefined, tray: Tray | undefined;
let connection: HostConnection | undefined;
let presence: Awaited<ReturnType<typeof import("./host-adapter.ts").attachWorkspaceHost>> | undefined;
let adapter: typeof import("./host-adapter.ts");
let renewal: ReturnType<typeof setInterval> | undefined, connecting = false, attempted = false, quitting = false, quitReady = false, explicitStop = false;
let pendingConnect: Promise<void> | undefined;
let message = "正在连接工作区…";

function connectionMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    HOST_INCOMPATIBLE: "工作区中的研究服务版本不兼容。请在原入口停止旧服务，再重新连接。",
    HOST_IDENTITY_CONFLICT: "已登记的服务身份与当前端口不一致。请核对原服务后重试；应用没有启动第二个服务。",
    HOST_UNREACHABLE: "已登记的研究服务暂时无法连接。请核对原服务状态后重试；应用没有启动第二个服务。",
    HOST_NOT_READY: "已登记的研究服务尚未就绪。请核对原服务状态后重试；应用没有启动第二个服务。",
    HOST_OWNER_NOT_READY: "已有进程持有工作区，但服务尚未就绪。请检查原入口后重试。",
    HOST_STARTUP_BUSY: "其他入口仍在启动研究服务，请稍后重新连接。",
    HOST_READY_TIMEOUT: "研究服务启动超时，请检查服务状态后重新连接。",
    HOST_METADATA_INVALID: "工作区服务登记损坏或版本未知。原登记已保留，请核对后重试。",
    HOST_LEGACY_LOCK: "工作区存在旧版服务锁。请确认旧服务已停止并核对锁文件，再重新连接。",
    HOST_REGISTRY_CONFLICT: "工作区已有运行中或状态未知的服务。请核对原服务后重试。",
    HOST_CLIENT_FAILED: "无法登记桌面连接。请核对研究服务状态后重新连接。",
    HOST_START_FAILED: "研究服务未能完成启动。请检查应用资源和本机配置后重试。",
    UNKNOWN: "无法启动本机研究服务。请检查系统应用控制策略和应用签名，或连接已运行的服务。",
    EACCES: "无法启动本机研究服务。请检查系统应用控制策略和应用签名，或连接已运行的服务。",
    EPERM: "无法启动本机研究服务。请检查系统应用控制策略和应用签名，或连接已运行的服务。",
  };
  return (code && messages[code]) || "研究服务无法连接，请检查本机服务状态后重试。";
}

function trustedRecovery(event: IpcMainInvokeEvent): boolean {
  return !!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === recoveryUrl;
}
function saveWindowState() {
  if (!window || window.isDestroyed()) return;
  const bounds = window.getNormalBounds();
  try { writeFileSync(join(stateDir, "window.json"), JSON.stringify({ width: bounds.width, height: bounds.height, maximized: window.isMaximized() })); } catch { /* Optional preference. */ }
}
async function showRecovery(text: string) {
  message = text;
  if (window && !window.isDestroyed()) await window.loadURL(recoveryUrl);
}
function connect(): Promise<void> {
  if (pendingConnect) return pendingConnect;
  if (quitting) return Promise.resolve();
  const task = connectOnce(); pendingConnect = task;
  void task.then(() => { if (pendingConnect === task) pendingConnect = undefined; }, () => { if (pendingConnect === task) pendingConnect = undefined; });
  return task;
}
async function connectOnce() {
  connecting = true; attempted = true; message = "正在连接工作区…";
  try {
    const executable = join(runtime, "whyj-host.exe"), assets = join(runtime, "web");
    process.env.WHYJ_DESKTOP_ASSETS = assets;
    const next = await adapter.connectWorkspaceHost({ workspaceRoot, bunExecutable: executable, entrypoint: executable });
    connection = next;
    const nextPresence = await adapter.attachWorkspaceHost(next, "desktop");
    if (quitting) { await nextPresence.detach().catch(() => {}); if (next.started) await adapter.stopWorkspaceHost(next, "if-idle").catch(() => {}); connection = undefined; return; }
    presence = nextPresence;
    await window?.loadURL(workbenchUrl);
    if (renewal) clearInterval(renewal);
    renewal = setInterval(() => { void nextPresence.renew().catch(async () => {
      if (quitting || connecting || presence !== nextPresence) return;
      if (renewal) clearInterval(renewal); renewal = undefined; presence = undefined; connection = undefined;
      await showRecovery("与研究服务的连接已中断。请重新连接并核对研究状态。");
    }); }, 30_000);
  } catch (error) {
    const owned = connection; await presence?.detach().catch(() => {}); presence = undefined; connection = undefined; connecting = false;
    if (owned?.started) await adapter.stopWorkspaceHost(owned, "if-idle").catch(() => {});
    const code = (error as { code?: string })?.code;
    const missing = ["ENOENT", "HOST_START_FAILED"].includes(code ?? "")
      && (!existsSync(join(runtime, "whyj-host.exe")) || !existsSync(join(runtime, "web", "index.html")));
    const detail = connectionMessage(error);
    if (!quitting) await showRecovery(missing ? "本机研究服务或界面资源缺失，且没有可复用的服务。请重新构建或安装应用。" : detail);
  } finally { connecting = false; }
}
async function finishQuit() {
  if (renewal) clearInterval(renewal);
  await pendingConnect?.catch(() => {});
  if (renewal) clearInterval(renewal);
  const owned = connection; connection = undefined;
  await presence?.detach().catch(() => {}); presence = undefined;
  window?.destroy(); window = undefined;
  if (owned && explicitStop) {
    try { await adapter.stopWorkspaceHost(owned, "explicit"); }
    catch { dialog.showErrorBox("WhyJ Quant", "停止研究服务未获确认；其他入口中的研究可能仍在运行。请重新连接核对。"); }
  } else if (owned?.started) {
    // The destroyed window's SSE stream may need a moment to detach. Retrying
    // an idle-only request never stops active work or another observer.
    for (let attempt = 0; attempt < 10; attempt++) {
      try { await adapter.stopWorkspaceHost(owned, "if-idle"); break; }
      catch { if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 200)); }
    }
  }
  tray?.destroy(); tray = undefined; quitReady = true; app.quit();
}
function openWindow() { if (!window || window.isDestroyed()) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); }

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", openWindow);
  app.on("activate", openWindow);
  app.on("window-all-closed", () => { /* The tray keeps the entry available. */ });
  app.on("before-quit", event => { if (quitReady) return; event.preventDefault(); if (!quitting) { quitting = true; void finishQuit(); } });
  void app.whenReady().then(async () => {
    mkdirSync(workspace, { recursive: true }); mkdirSync(workspaceRoot, { recursive: true }); process.chdir(workspace);
    app.setAppUserModelId("io.github.yangjingo.whyj-quant");
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    protocol.handle("app", async request => {
      const url = new URL(request.url), name = url.pathname.slice(1);
      if (url.host !== "desktop") return new Response("Not found", { status: 404 });
      if (["recovery.html", "recovery.js", "recovery.css", "logo-mark.svg"].includes(name)) return net.fetch(pathToFileURL(join(app.getAppPath(), "dist", name)).href);
      if (!connection || !["GET", "POST", "HEAD"].includes(request.method)
        || !(url.pathname === "/" || url.pathname.startsWith("/assets/") || ["/api/workbench/bootstrap", "/api/workbench/rpc", "/api/workbench/events"].includes(url.pathname))) return new Response("Not found", { status: 404 });
      // The stable app origin keeps view-only drafts across Host port changes.
      // Only the selected, authenticated loopback Host receives these requests.
      const target = new URL(connection.url); target.pathname = url.pathname; target.search = url.search;
      const headers = new Headers(request.headers); headers.delete("host"); headers.delete("origin"); headers.delete("sec-fetch-site");
      try { return await net.fetch(target.href, { method: request.method, headers, redirect: "error", signal: request.signal,
        ...(request.method === "POST" ? { body: await request.arrayBuffer() } : {}) }); }
      catch { return new Response("Host unavailable", { status: 503 }); }
    });
    adapter = await import(pathToFileURL(join(app.getAppPath(), "dist", "host-adapter.mjs")).href) as typeof adapter;
    let saved: { width?: number; height?: number; maximized?: boolean } = {};
    try { saved = JSON.parse(readFileSync(join(stateDir, "window.json"), "utf8")); } catch { /* First launch. */ }
    const area = screen.getPrimaryDisplay().workAreaSize;
    window = new BrowserWindow({ width: Math.min(area.width, Math.max(800, Number(saved.width) || 1280)), height: Math.min(area.height, Math.max(540, Number(saved.height) || 820)),
      minWidth: 390, minHeight: 480, show: false, title: `WhyJ Quant ${app.getVersion()}`, backgroundColor: "#10100f", icon: join(app.getAppPath(), "dist", "app-icon.ico"), autoHideMenuBar: true,
      webPreferences: { preload: join(app.getAppPath(), "dist", "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
    Menu.setApplicationMenu(null);
    window.webContents.setWindowOpenHandler(({ url }) => { try { const parsed = new URL(url); if (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password) void shell.openExternal(url); } catch { /* Reject malformed URLs. */ } return { action: "deny" }; });
    window.webContents.on("will-navigate", (event, value) => { const url = new URL(value); if (url.protocol !== "app:" || url.host !== "desktop" || !["/", "/recovery.html"].includes(url.pathname)) event.preventDefault(); });
    window.webContents.on("will-attach-webview", event => event.preventDefault());
    window.on("close", event => { if (!quitting) { event.preventDefault(); saveWindowState(); window?.hide(); } });
    tray = new Tray(join(app.getAppPath(), "dist", "app-icon.ico"));
    tray.setToolTip("WhyJ Quant"); tray.setContextMenu(Menu.buildFromTemplate([{ label: "打开研究工作台", click: openWindow }, { type: "separator" },
      { label: "退出 WhyJ Quant", click: () => app.quit() }, { label: "停止研究服务并退出…", click: async () => {
        const choice = await dialog.showMessageBox({ type: "warning", title: "停止研究服务", message: "停止服务会中止所有入口中正在运行的研究。", detail: "已完成的记录会保留，未确认的运行结果需要重新核对。", buttons: ["取消", "停止服务并退出"], defaultId: 0, cancelId: 0 });
        if (choice.response === 1) { explicitStop = true; app.quit(); }
      } }]));
    tray.on("double-click", openWindow);
    ipcMain.handle("recovery:status", event => { if (!trustedRecovery(event)) throw new Error("Invalid recovery request"); return { message, busy: connecting || !attempted }; });
    ipcMain.handle("recovery:retry", async event => { if (!trustedRecovery(event)) throw new Error("Invalid recovery request"); await connect(); });
    await window.loadURL(recoveryUrl); if (saved.maximized) window.maximize(); window.show(); await connect();
  }).catch(() => { if (quitting) return; message = "桌面应用启动失败，请检查应用资源和本机配置。"; if (window) void showRecovery(message); else { dialog.showErrorBox("WhyJ Quant", message); quitReady = true; app.quit(); } });
}
