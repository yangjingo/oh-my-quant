import { _electron as electron } from "playwright";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { inspectProcesses } from "./smoke-processes.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")).version;
const home = process.env.WHYJ_SMOKE_HOME || mkdtempSync(join(tmpdir(), "whyj-desktop-smoke-"));
const evidence = resolve(desktop, "../../output/playwright/desktop");
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
let stage = "launch";
let processQuery;
const saveResult = (status, error) => {
  const failure = error && { message: String(error), stack: error.stack, code: error.code };
  writeFileSync(join(evidence, "result.json"), JSON.stringify({ version,
    executable: executable || "development", home, revision: process.env.GITHUB_SHA || null,
    status, stage, checks, processQuery: error?.processQuery || processQuery,
    error: failure, at: new Date().toISOString() }, null, 2));
  if (error) writeFileSync(join(evidence, "failure.txt"), error.stack || String(error));
};
const record = (name) => { checks.push(name); stage = `after: ${name}`; saveResult("running"); console.log(`PASS ${name}`); };
try {
  application = await launch();
  let page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.waitForFunction(() => !!document.querySelector("#input") || !!document.querySelector("#retry:not(:disabled)"), null, { timeout: 45000 });
  if (await page.locator("#retry:not(:disabled)").isVisible()) throw new Error("Desktop Host startup failed: " + await page.locator("#message").innerText());
  const bootstrap = await page.evaluate(async () => (await (await fetch("/api/workbench/bootstrap")).json()));
  const origin = bootstrap.url;
  assert.ok(bootstrap.instanceId && bootstrap.token);
  record("installed Desktop starts the shared Host and React workbench");
  await page.screenshot({ path: join(evidence, "startup.png") });
  const preferences = await application.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { nodeIntegration: p.nodeIntegration, sandbox: p.sandbox, contextIsolation: p.contextIsolation };
  });
  assert.deepEqual(preferences, { nodeIntegration: false, sandbox: true, contextIsolation: true });
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(await page.evaluate(async () => { try { await window.desktopRecovery.status(); return false; } catch { return true; } }), true);
  record("renderer isolation and recovery IPC origin restriction");
  const input = page.getByRole("combobox", { name: "研究问题", exact: true });
  await input.fill("中文桌面草稿");
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  const electron = createRequire(join(desktop, "package.json"))("electron");
  const second = spawn(executable || electron, executable ? [] : [desktop], { env, stdio: "ignore", windowsHide: true });
  const secondExit = new Promise((done, reject) => { second.once("exit", done); second.once("error", reject); });
  await page.waitForFunction(() => document.visibilityState === "visible", null, { timeout: 15000 });
  await secondExit;
  assert.equal(await input.inputValue(), "中文桌面草稿");
  assert.equal(await page.evaluate(async () => (await (await fetch("/api/workbench/bootstrap")).json()).instanceId), bootstrap.instanceId);
  record("native close hides the window and a second launch restores the same Host and draft");
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(390, 720));
  await page.waitForFunction(() => innerWidth <= 390 && document.documentElement.scrollWidth <= innerWidth);
  await page.screenshot({ path: join(evidence, "compact.png") });
  record("narrow workbench keeps the composer accessible");
  // Validate the actual runtime beside the installed resources.
  const runtime = executable ? join(dirname(executable), "resources/runtime") : join(desktop, "runtime");
  const python = execFileSync(join(runtime, "python/python.exe"), ["-c", "import json,akshare,akquant,yfinance,pandas_market_calendars; print(json.dumps({'akshare':akshare.__version__}))"], { env, windowsHide: true, timeout: 60000, encoding: "utf8" });
  assert.equal(JSON.parse(python).akshare, "1.18.63");
  assert.equal(existsSync(join(runtime, "git")), false);
  assert.ok(execFileSync(join(runtime, "whyj.exe"), ["--version"], { env, windowsHide: true, timeout: 30000, encoding: "utf8" }).includes(`v${version}`));
  record("packaged Python data libraries and CLI version, with no bundled Git");
  const skills = join(home, "http-skills");
  const install = execFileSync(join(runtime, "whyj.exe"), ["--json", "--command", "/skill install llmquant-data"], {
    env: { ...env, PATH: "", OHQUANT_DIR: join(home, "skill-state"), OHQUANT_SKILLS_DIR: skills },
    windowsHide: true, timeout: 240000, encoding: "utf8",
  });
  assert.equal(JSON.parse(install).ok, true, install);
  const receipt = JSON.parse(readFileSync(join(skills, "LLMQuant-skills/.whyj-skill.json"), "utf8"));
  assert.equal(receipt.version, 1);
  assert.equal(receipt.revision, "1918237467c2dff4cc97a18ebc0892dfd46e8129");
  assert.ok(existsSync(join(skills, "LLMQuant-skills/skills/llmquant-data/SKILL.md")));
  assert.equal(existsSync(join(skills, "tradermonty-claude-trading-skills")), false);
  const trading = execFileSync(join(runtime, "whyj.exe"), ["--json", "--command", "/skill install technical-analyst"], {
    env: { ...env, PATH: "", OHQUANT_DIR: join(home, "skill-state"), OHQUANT_SKILLS_DIR: skills },
    windowsHide: true, timeout: 240000, encoding: "utf8",
  });
  assert.equal(JSON.parse(trading).ok, true, trading);
  assert.equal(JSON.parse(readFileSync(join(skills, "tradermonty-claude-trading-skills/.whyj-skill.json"), "utf8")).revision,
    "a2506fd1bab662723fb7142734320fef23fc48fa");
  assert.ok(existsSync(join(skills, "tradermonty-claude-trading-skills/skills/technical-analyst/SKILL.md")));
  assert.equal(existsSync(join(skills, "tradermonty-claude-trading-skills/examples/daily-market-dashboard/.claude/skills")), false);
  assert.deepEqual(JSON.parse(readFileSync(join(skills, ".selection.json"), "utf8")), {
    "LLMQuant-skills": ["llmquant-data"], "tradermonty-claude-trading-skills": ["technical-analyst"],
  });
  record("installed CLI downloads both pinned repositories over HTTPS with an empty PATH and selects only requested Skills");
  assert.deepEqual(errors, []);
  const closed = application.waitForEvent("close", { timeout: 15000 });
  await application.evaluate(({ app }) => app.quit()).catch(() => {});
  await closed; application = undefined;
  assert.ok(existsSync(join(home, "window.json")));
  for (let i = 0; i < 50; i++) { try { await fetch(origin + "/api/workbench/bootstrap"); } catch { break; } await new Promise(done => setTimeout(done, 100)); }
  await assert.rejects(fetch(origin + "/api/workbench/bootstrap"));
  record("quitting stops an idle Host started by this Desktop");
  stage = "process-cleanup-query"; saveResult("running");
  processQuery = inspectProcesses("whyj"); assert.deepEqual(processQuery.pids, [], "The isolated runner must have no orphaned WhyJ CLI processes");
  const hostQuery = inspectProcesses("whyj-host"); assert.deepEqual(hostQuery.pids, []);
  record("no CLI or Host process survives isolated idle shutdown");
  stage = "complete"; saveResult("passed"); console.log(`Evidence: ${evidence}`);
} catch (error) {
  // Shutdown failures have no live window. Persist them before optional UI capture.
  try { saveResult("failed", error); } catch (diagnosticError) {
    console.error("Could not save smoke failure diagnostics:", diagnosticError);
  }
  try {
    if (application) {
      const page = await application.firstWindow().catch(() => null);
      if (page) {
        await page.screenshot({ path: join(evidence, "failure.png") }).catch(() => {});
        writeFileSync(join(evidence, "failure-page.txt"), await page.locator("body").innerText().catch(() => ""));
      }
    }
  } catch (diagnosticError) { console.error("Could not capture the failed window:", diagnosticError); }
  throw error;
} finally {
  if (application) await application.close().catch(() => {});
}
