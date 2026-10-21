import { _electron as electron } from "playwright";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")).version;
const home = process.env.WHYJ_SMOKE_HOME || mkdtempSync(join(tmpdir(), "whyj-desktop-smoke-"));
const evidence = resolve(desktop, "../output/playwright/desktop");
mkdirSync(evidence, { recursive: true });
mkdirSync(join(home, "profile"), { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(systemroot|windir|comspec|temp|tmp|localappdata|appdata|username|userdomain|processor_architecture|number_of_processors)$/i.test(key)));
env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`;
env.USERPROFILE = join(home, "profile");
env.HOME = env.USERPROFILE;
env.WHYJ_DESKTOP_HOME = home;
const executable = process.env.WHYJ_SMOKE_EXE;
const launch = () => electron.launch({
  ...(executable ? { executablePath: executable, args: [] } : { args: [desktop] }), env, timeout: 60_000,
});
let application;
const checks = [];
const record = (name) => { checks.push(name); console.log(`PASS ${name}`); };
async function waitFor(page, text, present = true) {
  await page.waitForFunction(({ text, present }) =>
    !!document.querySelector(".xterm-accessibility-tree")?.textContent?.includes(text) === present,
    { text, present }, { timeout: 45_000 });
}
try {
  application = await launch();
  let page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await waitFor(page, `WhyJ Quant v${version}`);
  assert.equal(await page.locator("#error").isVisible(), false);
  assert.equal(await page.locator("#status").textContent(), `Desktop ${version}`);
  record("fresh profile starts the bundled CLI with no Node/Bun/Python/Git on PATH");
  await page.screenshot({ path: join(evidence, "startup.png") });
  assert.equal(await page.locator('img.mark').evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.equal(await page.locator('body').evaluate(body => getComputedStyle(body).color), 'rgb(255, 243, 196)');
  record("shared JQ mark loads through the app protocol and warm text is rendered");
  const preferences = await application.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { nodeIntegration: prefs.nodeIntegration, sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation };
  });
  assert.deepEqual(preferences, { nodeIntegration: false, sandbox: true, contextIsolation: true });
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  record("renderer sandbox, context isolation and disabled Node integration");
  await page.keyboard.type("/help");
  await page.keyboard.press("Enter");
  await waitFor(page, "Commands");
  await page.screenshot({ path: join(evidence, "help.png") });
  await page.keyboard.press("Escape");
  await waitFor(page, "[Commands] / Hotkeys", false);
  await page.keyboard.press("Control+p");
  await waitFor(page, "Settings");
  await page.screenshot({ path: join(evidence, "settings.png") });
  const settingsPath = join(home, "workspace/.ohquant/settings.json");
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).preferences.source, "akshare");
  for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await waitFor(page, "Green ↑ Red ↓");
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).preferences.marketColorScheme, "green-up");
  await page.keyboard.press("Escape");
  await waitFor(page, "╭─ Settings", false);
  record("original help/settings, public AKShare first-run default and settings persistence");
  for (const [command, title] of [["/portfolio", "╭─ Portfolios"], ["/resume", "Resume a previous session"], ["/artifact", "╭─ Artifacts"]]) {
    await page.keyboard.type(command);
    await page.keyboard.press("Enter");
    await waitFor(page, title);
    await page.keyboard.press("Escape");
    await waitFor(page, title, false);
  }
  record("portfolio, saved-session and research-report panels");
  await application.evaluate(async ({ clipboard }) => { await clipboard.writeText("中文桌面输入验证\n/exit"); });
  await page.keyboard.press("Control+v");
  await waitFor(page, "中文桌面输入验证");
  await waitFor(page, "/exit");
  // Do not submit a model request; remove the composed text.
  await page.keyboard.press("Control+c");
  record("Unicode multiline clipboard paste remains in the composer without executing /exit");
  await page.getByRole("button", { name: "放大字号", exact: true }).click();
  assert.equal(await page.locator("#font-reset").textContent(), "15px");
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 600));
  await waitFor(page, "Composer");
  await page.waitForFunction(() => {
    const terminal = document.querySelector(".xterm-screen").getBoundingClientRect();
    const footer = document.querySelector("footer").getBoundingClientRect();
    return terminal.bottom <= footer.top && terminal.right <= window.innerWidth;
  });
  await page.screenshot({ path: join(evidence, "compact.png") });
  record("font adjustment and responsive ConPTY resize");
  // Validate the actual runtime beside the installed resources.
  const runtime = executable ? join(dirname(executable), "resources/runtime") : join(desktop, "runtime");
  const python = execFileSync(join(runtime, "python/python.exe"), ["-c", "import json,akshare,akquant,yfinance,pandas_market_calendars; print(json.dumps({'akshare':akshare.__version__}))"], { env, windowsHide: true, timeout: 60000, encoding: "utf8" });
  assert.equal(JSON.parse(python).akshare, "1.18.63");
  assert.match(execFileSync(join(runtime, "git/cmd/git.exe"), ["--version"], { env, windowsHide: true, encoding: "utf8" }), /git version/);
  assert.ok(execFileSync(join(runtime, "whyj.exe"), ["--version"], { env, windowsHide: true, timeout: 30000, encoding: "utf8" }).includes(`v${version}`));
  record("packaged Python data libraries, Git and CLI version");
  await page.keyboard.type("/exit");
  await Promise.all([application.waitForEvent("close", { timeout: 15000 }), page.keyboard.press("Enter")]);
  application = undefined;
  record("CLI exit closes the desktop process");
  application = await launch();
  page = await application.firstWindow();
  await waitFor(page, `WhyJ Quant v${version}`);
  assert.equal(await page.locator("#font-reset").textContent(), "15px");
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).preferences.marketColorScheme, "green-up");
  record("desktop preferences survive restart");
  // A window-close follows the same runtime shutdown as the user's title-bar X.
  await Promise.all([application.waitForEvent("close", { timeout: 15000 }),
    application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())]);
  application = undefined;
  assert.ok(existsSync(join(home, "window.json")));
  const bounds = JSON.parse(readFileSync(join(home, "window.json"), "utf8"));
  assert.equal(bounds.width, 820);
  record("native window close and persisted window bounds");
  const remaining = execFileSync(join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
    ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='whyj.exe'\" | Select-Object -ExpandProperty ProcessId"],
    { windowsHide: true, encoding: "utf8", timeout: 20000 }).trim();
  assert.equal(remaining, "", "The isolated test runner must have no orphaned WhyJ CLI processes");
  record("no CLI process survives desktop shutdown");
  assert.deepEqual(errors, []);
  writeFileSync(join(evidence, "result.json"), JSON.stringify({ version, executable: executable || "development", home, checks, at: new Date().toISOString() }, null, 2));
  console.log(`Evidence: ${evidence}`);
} catch (error) {
  if (application) {
    const page = await application.firstWindow().catch(() => null);
    if (page) {
      await page.screenshot({ path: join(evidence, "failure.png") }).catch(() => {});
      writeFileSync(join(evidence, "failure.txt"), `${error}\n${await page.locator("body").innerText().catch(() => "")}`);
    }
  }
  throw error;
} finally {
  if (application) await application.close().catch(() => {});
}
