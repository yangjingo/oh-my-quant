import { WHYJ_THEME } from "../../src/types/theme-colors.ts";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type {} from "./bridge.ts";

const terminal = new Terminal({
  fontFamily: '"Cascadia Mono", Consolas, "Microsoft YaHei", monospace',
  fontSize: Math.max(11, Math.min(22, Number(localStorage.getItem("fontSize")) || 14)),
  lineHeight: 1.18, cursorBlink: false, scrollback: 1000, screenReaderMode: true,
  theme: { background: WHYJ_THEME.canvas, foreground: WHYJ_THEME.cream, cursor: WHYJ_THEME.gold, selectionBackground: `${WHYJ_THEME.gold}44` },
});
const fit = new FitAddon();
terminal.loadAddon(fit);
terminal.loadAddon(new WebLinksAddon((_event, url) => { void window.desktop.openLink(url).catch(showError); }));
terminal.open(document.getElementById("terminal")!);
const status = document.getElementById("status")!;
const errorPanel = document.getElementById("error")!;
let started = false;
function showError(error: unknown): void {
  document.getElementById("error-message")!.textContent = error instanceof Error ? error.message : String(error);
  errorPanel.hidden = false;
  status.textContent = "Disconnected";
}
function resize(): void {
  fit.fit();
  if (started) window.desktop.resize({ cols: terminal.cols, rows: terminal.rows });
}
function changeFont(delta: number): void {
  terminal.options.fontSize = Math.max(11, Math.min(22, delta === 0 ? 14 : (terminal.options.fontSize || 14) + delta));
  localStorage.setItem("fontSize", String(terminal.options.fontSize));
  document.getElementById("font-reset")!.textContent = `${terminal.options.fontSize}px`;
  resize();
  terminal.focus();
}
window.desktop.onData(data => terminal.write(data, () => window.desktop.acknowledge(data.length)));
window.desktop.onExit(code => { started = false; showError(`Terminal exited with code ${code}. Your saved sessions are available in /resume after restarting.`); });
terminal.onData(data => window.desktop.input(data));
terminal.attachCustomKeyEventHandler(event => {
  if (event.type !== "keydown" || !event.ctrlKey) return true;
  const key = event.key.toLowerCase();
  if (key === "c" && (event.shiftKey || terminal.hasSelection())) {
    if (terminal.hasSelection()) void window.desktop.copy(terminal.getSelection()).catch(showError);
    else window.desktop.input("\x1b[67;6u"); // Existing TUI conversation selection shortcut.
    event.preventDefault(); return false;
  }
  if (key === "v") {
    void window.desktop.paste().then(text => terminal.paste(text)).catch(showError);
    event.preventDefault(); return false;
  }
  if (["+", "=", "-", "0"].includes(key)) {
    changeFont(key === "0" ? 0 : key === "-" ? -1 : 1);
    event.preventDefault(); return false;
  }
  return true;
});
document.getElementById("font-smaller")!.addEventListener("click", () => changeFont(-1));
document.getElementById("font-larger")!.addEventListener("click", () => changeFont(1));
document.getElementById("font-reset")!.addEventListener("click", () => changeFont(0));
document.getElementById("workspace")!.addEventListener("click", () => {
  void window.desktop.openWorkspace().then(error => { if (error) showError(error); }).catch(showError);
});
document.getElementById("retry")!.addEventListener("click", () => { void start(); });
new ResizeObserver(resize).observe(document.getElementById("terminal")!);
async function start(): Promise<void> {
  errorPanel.hidden = true;
  status.textContent = "Starting…";
  try {
    fit.fit();
    const info = await window.desktop.start({ cols: terminal.cols, rows: terminal.rows });
    started = true;
    status.textContent = `Desktop ${info.version}`;
    document.getElementById("workspace")!.title = info.workspace;
    terminal.focus();
    resize();
  } catch (error) { showError(error); }
}
document.getElementById("font-reset")!.textContent = `${terminal.options.fontSize}px`;
void document.fonts.ready.then(start);
