import { WHYJ_THEME } from "../../src/types/theme-colors.ts";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, screen, session, shell } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { spawn } from "node-pty";
import type { IPty } from "node-pty";
import type { TerminalSize } from "./bridge.ts";

const pageUrl = "app://desktop/index.html";
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
// Explicit override also supports isolated installed-package acceptance tests.
app.setPath("userData", process.env.WHYJ_DESKTOP_HOME || join(app.getPath("appData"), "WhyJ Quant"));
const stateDir = app.getPath("userData");
const workspace = join(stateDir, "workspace");
const runtime = app.isPackaged ? join(process.resourcesPath, "runtime") : join(app.getAppPath(), "runtime");
let window: BrowserWindow | undefined;
let terminal: IPty | undefined;
let pendingBytes = 0;
let closing = false;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame.url === pageUrl;
}
function validSize(value: unknown): value is TerminalSize {
  if (!value || typeof value !== "object") return false;
  const size = value as TerminalSize;
  return Number.isInteger(size.cols) && Number.isInteger(size.rows)
    && size.cols >= 20 && size.cols <= 500 && size.rows >= 5 && size.rows <= 250;
}
function saveWindowState(): void {
  if (!window || window.isDestroyed()) return;
  const bounds = window.getNormalBounds();
  try { writeFileSync(join(stateDir, "window.json"), JSON.stringify({ width: bounds.width, height: bounds.height, maximized: window.isMaximized() })); } catch { /* Window state is optional. */ }
}
function stopTree(): void {
  const child = terminal;
  terminal = undefined;
  if (!child) return;
  // ConPTY can outlive its window; terminate the child tree including Python/Git.
  execFile(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
    ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }, () => {
      try { child.kill(); } catch { /* Already exited. */ }
      if (closing) window?.destroy();
    });
}
function startTerminal(size: TerminalSize): void {
  if (terminal) return;
  const executable = join(runtime, "whyj.exe");
  if (!existsSync(executable)) throw new Error("The bundled terminal is missing. Please reinstall WhyJ Quant.");
  const python = join(runtime, "python");
  const git = join(runtime, "git", "cmd");
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !["path", "electron_run_as_node", "node_options", "pythonhome", "pythonpath"].includes(key.toLowerCase())) env[key] = value;
  }
  Object.assign(env, {
    PATH: [python, git, process.env.PATH || process.env.Path || ""].join(";"),
    TERM: "xterm-256color", COLORTERM: "truecolor", FORCE_COLOR: "3",
    OHQUANT_DIR: join(workspace, ".ohquant"), WHYJ_PYTHON: join(python, "python.exe"),
    WHYJ_DESKTOP: "1",
    WHYJ_RESOURCE_ROOT: runtime, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8",
  });
  pendingBytes = 0;
  const child = spawn(executable, [], { name: "xterm-256color", cols: size.cols, rows: size.rows, cwd: workspace, env });
  terminal = child;
  child.onData(data => {
    if (!window || window.isDestroyed()) return;
    pendingBytes += data.length;
    window.webContents.send("terminal:data", data);
    if (pendingBytes > 256 * 1024) child.pause();
  });
  child.onExit(({ exitCode }) => {
    if (terminal === child) terminal = undefined;
    if (closeTimer) clearTimeout(closeTimer);
    if (closing || exitCode === 0) { saveWindowState(); window?.destroy(); return; }
    if (window && !window.isDestroyed()) window.webContents.send("terminal:exit", exitCode);
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => { if (!window || window.isDestroyed()) stopTree(); });
  void app.whenReady().then(async () => {
    mkdirSync(workspace, { recursive: true });
    app.setAppUserModelId("io.github.yangjingo.whyj-quant");
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    protocol.handle("app", request => {
      const url = new URL(request.url);
      const filename = url.pathname.slice(1);
      if (url.host !== "desktop" || !["index.html", "renderer.js", "style.css", "xterm.css", "logo-mark.svg"].includes(filename)) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(join(app.getAppPath(), "dist", filename)).href);
    });
    let saved: { width?: number; height?: number; maximized?: boolean } = {};
    try { saved = JSON.parse(readFileSync(join(stateDir, "window.json"), "utf8")); } catch { /* First launch. */ }
    const area = screen.getPrimaryDisplay().workAreaSize;
    const width = Math.min(area.width, Math.max(800, Number(saved.width) || 1280));
    const height = Math.min(area.height, Math.max(540, Number(saved.height) || 820));
    window = new BrowserWindow({ width, height, minWidth: 720, minHeight: 480, show: false,
      title: `WhyJ Quant ${app.getVersion()}`, backgroundColor: WHYJ_THEME.canvas, icon: join(app.getAppPath(), "dist", "app-icon.ico"),
      autoHideMenuBar: true,
      webPreferences: { preload: join(app.getAppPath(), "dist", "preload.cjs"), contextIsolation: true,
        nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
    });
    Menu.setApplicationMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.webContents.on("will-attach-webview", event => event.preventDefault());
    window.webContents.on("render-process-gone", () => { stopTree(); });
    window.on("close", event => {
      if (closing) return;
      saveWindowState();
      if (!terminal) return;
      event.preventDefault();
      closing = true;
      window!.hide();
      // Ctrl+D uses the same shutdown path as /exit; allow journals to flush.
      terminal.write("\x04");
      closeTimer = setTimeout(stopTree, 4000);
    });
    ipcMain.handle("terminal:start", (event, size: unknown) => {
      if (!trusted(event) || !validSize(size) || closing) throw new Error("Invalid terminal request");
      startTerminal(size);
      return { version: app.getVersion(), workspace };
    });
    ipcMain.on("terminal:input", (event, data: unknown) => {
      if (trusted(event) && typeof data === "string" && data.length <= 1024 * 1024 && !closing) terminal?.write(data);
    });
    ipcMain.on("terminal:resize", (event, size: unknown) => {
      if (trusted(event) && validSize(size)) terminal?.resize(size.cols, size.rows);
    });
    ipcMain.on("terminal:ack", (event, length: unknown) => {
      if (!trusted(event) || typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > pendingBytes) return;
      pendingBytes -= length;
      if (pendingBytes < 64 * 1024) terminal?.resume();
    });
    ipcMain.handle("clipboard:copy", async (event, text: unknown) => {
      if (!trusted(event) || typeof text !== "string" || text.length > 1024 * 1024) throw new Error("Invalid clipboard request");
      await clipboard.writeText(text);
    });
    ipcMain.handle("clipboard:paste", async event => { if (!trusted(event)) throw new Error("Invalid clipboard request"); return (await clipboard.readText()).slice(0, 1024 * 1024); });
    ipcMain.handle("workspace:open", event => { if (!trusted(event)) throw new Error("Invalid workspace request"); return shell.openPath(workspace); });
    ipcMain.handle("link:open", async (event, value: unknown) => {
      if (!trusted(event) || typeof value !== "string" || value.length > 4096) throw new Error("Invalid link request");
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Unsupported link");
      await shell.openExternal(url.href);
    });
    await window.loadURL(pageUrl);
    if (saved.maximized) window.maximize();
    window.show();
  }).catch(error => { dialog.showErrorBox("WhyJ Quant could not start", String(error)); app.exit(1); });
}
