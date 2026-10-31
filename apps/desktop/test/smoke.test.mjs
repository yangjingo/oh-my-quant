import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { inspectProcesses } from "../scripts/smoke-processes.mjs";

const source = readFileSync(process.env.WHYJ_TEST_SMOKE_SOURCE || new URL("../scripts/smoke.mjs", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "whyj-smoke-regression-"));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

// Execute the actual smoke control flow with fake Electron/commands and isolated
// files. This reproduces the post-close catch path without installing an app.
async function runSmoke(t, { queryError, pids = [], failDiagnosticWrite = false } = {}) {
  const root = fixture(t), home = join(root, "home");
  mkdirSync(join(root, "apps/desktop/scripts"), { recursive: true });
  mkdirSync(join(home, "workspace/.ohquant"), { recursive: true });
  writeFileSync(join(root, "apps/desktop/package.json"), JSON.stringify({ version: "1.4.0" }));
  writeFileSync(join(home, "workspace/.ohquant/settings.json"), JSON.stringify({ preferences: { source: "akshare", marketColorScheme: "green-up" } }));
  writeFileSync(join(home, "window.json"), JSON.stringify({ width: 820 }));
  let draft = "";
  const page = {
    url: () => "http://127.0.0.1:4182/",
    waitForFunction: async () => {}, screenshot: async () => {}, evaluate: async fn => {
      const source = fn.toString();
      if (source.includes("desktopRecovery")) return true;
      if (source.includes("instanceId")) return "fixture-instance";
      if (source.includes("bootstrap")) return { instanceId: "fixture-instance", token: "fixture-token", url: "http://127.0.0.1:4182" };
      return "undefined";
    },
    keyboard: { type: async () => {}, press: async () => {} }, on: () => {},
    getByRole: () => ({ click: async () => {}, fill: async text => { draft = text; }, inputValue: async () => draft }),
    locator: selector => ({ isVisible: async () => false, innerText: async () => "fixture",
      textContent: async () => selector === "#status" ? "Desktop 1.4.0" : "15px",
      evaluate: async () => selector === "img.mark" ? true : "rgb(255, 243, 196)" }),
  };
  const application = { firstWindow: async () => page, waitForEvent: async () => {}, close: async () => {},
    evaluate: async fn => fn.toString().includes("getLastWebPreferences")
      ? { nodeIntegration: false, sandbox: true, contextIsolation: true } : fn.toString().includes("isVisible") ? false : undefined };
  const command = (file, args, options) => {
    if (file.endsWith("powershell.exe")) {
      if (queryError) throw queryError;
      return args.join(" ").includes("Get-CimInstance") ? pids.join("\n") : JSON.stringify(pids);
    }
    if (file.endsWith("python.exe")) return '{"akshare":"1.18.63"}';
    if (file.endsWith("whyj.exe") && args.includes("--command")) {
      const skills = options.env.OHQUANT_SKILLS_DIR;
      assert.equal(skills, join(home, "http-skills"));
      assert.equal(options.env.PATH, "");
      const first = args.at(-1) === "/skill install llmquant-data";
      if (!first) assert.equal(args.at(-1), "/skill install technical-analyst");
      const repository = first ? "LLMQuant-skills" : "tradermonty-claude-trading-skills";
      const skill = first ? "llmquant-data" : "technical-analyst";
      mkdirSync(join(skills, repository, "skills", skill), { recursive: true });
      writeFileSync(join(skills, repository, "skills", skill, "SKILL.md"), "fixture");
      writeFileSync(join(skills, repository, ".whyj-skill.json"), JSON.stringify({ version: 1,
        revision: first ? "1918237467c2dff4cc97a18ebc0892dfd46e8129" : "a2506fd1bab662723fb7142734320fef23fc48fa" }));
      const selected = { "LLMQuant-skills": ["llmquant-data"] };
      if (!first) selected[repository] = [skill];
      writeFileSync(join(skills, ".selection.json"), JSON.stringify(selected));
      return '{"ok":true}';
    }
    return "WhyJ Quant v1.4.0";
  };
  const bindings = { electron: { launch: async () => application }, assert, mkdtempSync, mkdirSync,
    readFileSync, existsSync, tmpdir, dirname, join, resolve, fileURLToPath,
    scriptUrl: pathToFileURL(join(root, "apps/desktop/scripts/smoke.mjs")).href,
    process: { env: { SystemRoot: process.env.SystemRoot || "C:\\Windows", WHYJ_SMOKE_HOME: home, GITHUB_SHA: "fixture-revision" } },
    console: { log() {}, error() {} }, execFileSync: command,
    createRequire: () => () => "electron.exe",
    spawn: () => ({ once(event, callback) { if (event === "exit") queueMicrotask(() => callback(0)); return this; } }),
    fetch: async () => { throw new Error("Host stopped"); },
    inspectProcesses: name => inspectProcesses(name, command),
    writeFileSync: (file, ...args) => {
      if (failDiagnosticWrite && queryError?.processQuery && /result\.json$/.test(file)) throw new Error("receipt disk failure");
      return writeFileSync(file, ...args);
    },
  };
  let error;
  try {
    await new AsyncFunction(...Object.keys(bindings), source.replace(/^import .*;\r?\n/gm, "").replaceAll("import.meta.url", "scriptUrl"))(...Object.values(bindings));
  } catch (caught) { error = caught; }
  const evidence = join(root, "output/playwright/desktop");
  return { error, evidence, result: existsSync(join(evidence, "result.json"))
    ? JSON.parse(readFileSync(join(evidence, "result.json"), "utf8")) : undefined };
}

test("post-close query timeout retains partial checks and the original failure without a window", async t => {
  const failure = Object.assign(new Error("spawnSync powershell.exe ETIMEDOUT"), { code: "ETIMEDOUT", status: null, signal: "SIGTERM", stdout: "", stderr: "" });
  const { error, evidence, result } = await runSmoke(t, { queryError: failure });
  assert.equal(error, failure);
  assert.equal(result?.status, "failed");
  assert.equal(result.stage, "process-cleanup-query");
  assert.equal(result.revision, "fixture-revision");
  assert.equal(result.checks.length, 7);
  assert.equal(result.processQuery.code, "ETIMEDOUT");
  assert.equal(result.processQuery.timeoutMs, 20000);
  assert.match(readFileSync(join(evidence, "failure.txt"), "utf8"), /ETIMEDOUT/);
});

test("a surviving CLI fails and its PID is retained", async t => {
  const { error, result } = await runSmoke(t, { pids: [42] });
  assert.match(error.message, /no orphaned/);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.processQuery.pids, [42]);
});

test("normal completion retains every existing smoke check", async t => {
  const { error, result } = await runSmoke(t);
  assert.equal(error, undefined);
  assert.equal(result.status, "passed");
  assert.equal(result.checks.length, 8);
  assert.ok(result.checks.some(check => check.includes("both pinned repositories over HTTPS")));
  assert.deepEqual(result.processQuery.pids, []);
});

test("diagnostic write errors cannot mask the original failure", async t => {
  const failure = Object.assign(new Error("query timeout"), { code: "ETIMEDOUT" });
  assert.equal((await runSmoke(t, { queryError: failure, failDiagnosticWrite: true })).error, failure);
});

test("process query fails closed on nonzero exits and malformed responses", () => {
  const failure = Object.assign(new Error("process query failed"), { status: 1, stderr: "denied" });
  assert.throws(() => inspectProcesses("whyj", () => { throw failure; }), error => error === failure && error.processQuery.status === 1);
  for (const response of ["", "null", "{}", "42", "[0]", '["42"]', "INFO: no tasks"]) {
    assert.throws(() => inspectProcesses("whyj", () => response), undefined, response);
  }
});

test("process enumeration preserves its timeout and does not invoke CIM", () => {
  const query = inspectProcesses("whyj", (_file, args, options) => {
    assert.doesNotMatch(args.join(" "), /Cim|Wmi/);
    assert.match(args.join(" "), /GetProcessesByName/);
    assert.equal(options.timeout, 20000);
    assert.equal(options.env.WHYJ_SMOKE_PROCESS_NAME, "whyj");
    return "[]";
  });
  assert.deepEqual(query.pids, []);
});

test("a real stalled subprocess fails with timeout diagnostics", () => {
  assert.throws(() => inspectProcesses("whyj", () => execFileSync(process.execPath,
    ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, timeout: 100, encoding: "utf8" })), error => {
    assert.equal(error.code, "ETIMEDOUT");
    assert.equal(error.processQuery.code, "ETIMEDOUT");
    assert.ok(error.processQuery.durationMs >= 90);
    return true;
  });
});

test("process timeouts preserve partial stage output without replacing the original error", () => {
  for (const stderr of ["", "WHYJ_QUERY_STAGE=start\n"]) {
    const failure = Object.assign(new Error("query timed out"), { code: "ETIMEDOUT", stderr });
    assert.throws(() => inspectProcesses("whyj", () => { throw failure; }), error => {
      assert.equal(error, failure);
      assert.equal(error.processQuery.code, "ETIMEDOUT");
      assert.equal(error.processQuery.stderr, stderr);
      return true;
    });
  }
});

test("Windows query finds a live child and observes its exit", { skip: process.platform !== "win32" }, async t => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await once(child, "spawn");
  const name = process.execPath.split(/[\\/]/).at(-1).replace(/\.exe$/i, "");
  const withStages = (file, args, options) => {
    const result = spawnSync(file, args, options);
    if (result.error) throw Object.assign(result.error, { stdout: result.stdout, stderr: result.stderr });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /WHYJ_QUERY_STAGE=start/);
    assert.match(result.stderr, /WHYJ_QUERY_STAGE=enumerated/);
    return result.stdout;
  };
  assert.ok(inspectProcesses(name, withStages).pids.includes(child.pid));
  const exit = once(child, "exit");
  child.kill();
  await exit;
  assert.equal(inspectProcesses(name).pids.includes(child.pid), false);
});
