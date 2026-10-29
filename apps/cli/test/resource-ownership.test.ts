import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { connectWorkspaceHost, stopWorkspaceHost } from "../../../src/app/bootstrap.ts";
import { acquireResourceLeases, createHostRuntimeStore, hostProcessState } from "../../../src/storage/index.ts";
import { DEFAULT_SETTINGS } from "../../../src/types/config.ts";
import { researchWorkspaceId } from "../../../src/app/services/workspace.ts";
import { HOST_PROTOCOL_VERSION, HOST_SERVICE_CONTRACT_VERSION } from "../../../src/app/host/protocol.ts";
import { executeResourceCommand } from "../src/resource-command.ts";

const cli = resolve(import.meta.dir, "../../../src/index.ts");
async function oneShot(project: string, state: string, text = "/mcp install tushare --local", piDir = join(project, "pi-user")) {
  const child = Bun.spawn([process.execPath, cli, "--json", "-c", text], {
    cwd: project, env: { ...process.env, OHQUANT_DIR: state, PI_CODING_AGENT_DIR: piDir },
    stdout: "pipe", stderr: "pipe", timeout: 10000,
  });
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { exit, result: JSON.parse(stdout), stderr };
}
let previousLeaseRoot: string | undefined;
beforeEach(() => { previousLeaseRoot = process.env.WHYJ_RESOURCE_LEASE_ROOT; });
afterEach(() => { if (previousLeaseRoot === undefined) delete process.env.WHYJ_RESOURCE_LEASE_ROOT; else process.env.WHYJ_RESOURCE_LEASE_ROOT = previousLeaseRoot; });
function fixture() {
  const project = mkdtempSync(join(tmpdir(), "whyj-resource-owner-")), state = join(project, "state");
  process.env.WHYJ_RESOURCE_LEASE_ROOT = join(project, "lease-registry");
  mkdirSync(join(state, "assets"), { recursive: true });
  writeFileSync(join(state, "assets", "index.html"), "<html><body>Fixture</body></html>");
  return { project, state, config: join(project, ".pi", "mcp.json") };
}
function cleanup(project: string) {
  if (!resolve(project).startsWith(resolve(tmpdir()) + sep + "whyj-resource-owner-")) throw new Error("Unexpected fixture path");
  rmSync(project, { recursive: true, force: true });
}

test("one-shot local MCP management remains available without a Host", async () => {
  const { project, state, config } = fixture();
  try {
    const result = await oneShot(project, state);
    expect(result.exit).toBe(0); expect(result.result.ok).toBe(true); expect(result.stderr).toBe("");
    expect(readFileSync(config, "utf8")).toContain("tushare");
    expect(createHostRuntimeStore(state).readOwner("owner")).toBeUndefined();
  } finally { cleanup(project); }
}, 15000);

test("one-shot resource changes fail closed while an owner has not published readiness", async () => {
  const { project, state, config } = fixture();
  const store = createHostRuntimeStore(state), lease = store.acquire("owner");
  try {
    const result = await oneShot(project, state);
    expect(result.exit).not.toBe(0); expect(result.result.ok).toBe(false);
    expect(existsSync(config)).toBe(false); expect(store.readOwner("owner")?.instanceId).toBe(lease.instanceId);
    expect(store.read()).toBeUndefined();
  } finally { lease.release(); cleanup(project); }
}, 15000);

test("one-shot resource listings do not bypass a shared writer", async () => {
  const { project, state } = fixture(), skills = join(project, "shared-skills"), pi = join(project, "pi-user");
  const previousSkills = process.env.OHQUANT_SKILLS_DIR; process.env.OHQUANT_SKILLS_DIR = skills;
  try {
    for (const [path, command] of [[skills, "/skill catalog"], [skills, "/skill list"], [skills, "/skill install"],
      [pi, "/mcp list"], [join(project, ".pi"), "/mcp list --local"]] as const) {
      const release = await acquireResourceLeases([path], "write");
      try {
        const blocked = await oneShot(project, state, command);
        expect(blocked.exit).not.toBe(0); expect(blocked.result.ok).toBe(false);
        if (command === "/skill catalog") expect((await oneShot(project, state, "/skill --help")).exit).toBe(0);
        if (command === "/mcp list") {
          expect((await oneShot(project, state, "/mcp --help")).exit).toBe(0);
          expect((await oneShot(project, state, "/mcp info tushare")).exit).toBe(0);
          expect((await oneShot(project, state, "/mcp export tushare")).exit).toBe(0);
        }
      } finally { await release(); }
      const allowed = await oneShot(project, state, command);
      expect(allowed.exit).toBe(0); expect(allowed.result.ok).toBe(true);
      expect(createHostRuntimeStore(state).readOwner("owner")).toBeUndefined();
    }
  } finally {
    if (previousSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = previousSkills;
    cleanup(project);
  }
}, 45000);

for (const command of ["/mcp list --local", "/mcp install tushare --local"]) test(`project MCP operation reads the user scope safely: ${command}`, async () => {
  const { project, state, config } = fixture(), userMcp = join(project, "pi-user");
  try {
    const writer = await acquireResourceLeases([userMcp], "write");
    try {
      const blocked = await oneShot(project, state, command);
      expect(blocked.exit).not.toBe(0); expect(blocked.result.ok).toBe(false); expect(existsSync(config)).toBe(false);
    } finally { await writer(); }
    const allowed = await oneShot(project, state, command);
    expect(allowed.exit).toBe(0); expect(allowed.result.ok).toBe(true);
  } finally { cleanup(project); }
}, 15000);

test("project and user MCP directories may identify the same resource without self-conflict", async () => {
  const { project, state, config } = fixture();
  try {
    const same = join(project, ".pi");
    const installed = await oneShot(project, state, "/mcp install tushare --local", same);
    expect(installed.exit).toBe(0); expect(installed.result.ok).toBe(true);
    expect(readFileSync(config, "utf8")).toContain("tushare");
    const listed = await oneShot(project, state, "/mcp list --local", same);
    expect(listed.exit).toBe(0); expect(listed.result.ok).toBe(true);
  } finally { cleanup(project); }
}, 15000);

test("a standalone resource operation holds the owner until it completes", async () => {
  const { project, state, config } = fixture(), oldState = process.env.OHQUANT_DIR, oldProject = process.env.WHYJ_TEST_PROJECT;
  process.env.OHQUANT_DIR = state; process.env.WHYJ_TEST_PROJECT = project;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = executeResourceCommand({ command: "mcp", positional: ["install", "tushare"], flags: { local: true }, raw: "/mcp install tushare --local" }, async () => {
    await gate; return { success: true, message: "fixture complete" };
  });
  try {
    const store = createHostRuntimeStore(state), owner = store.readOwner("owner"); expect(owner?.pid).toBe(process.pid);
    const concurrent = await oneShot(project, state);
    expect(concurrent.exit).not.toBe(0); expect(existsSync(config)).toBe(false);
    await expect(connectWorkspaceHost({ workspaceRoot: state, entrypoint: join(import.meta.dir, "fixtures/resource-host.ts"), timeoutMs: 3000 })).rejects.toThrow();
    expect(store.readOwner("owner")?.instanceId).toBe(owner?.instanceId); expect(store.read()).toBeUndefined();
  } finally {
    release(); await pending;
    if (oldState === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = oldState;
    if (oldProject === undefined) delete process.env.WHYJ_TEST_PROJECT; else process.env.WHYJ_TEST_PROJECT = oldProject;
    cleanup(project);
  }
}, 20000);

for (const incompatible of [false, true]) test(`one-shot resource changes preserve a live ${incompatible ? "incompatible" : "unreachable"} registration`, async () => {
  const { project, state, config } = fixture();
  const store = createHostRuntimeStore(state), lease = store.acquire("owner");
  const token = "a".repeat(64), controlToken = "b".repeat(64);
  try {
    store.publish({ ...lease, workspaceId: researchWorkspaceId(state), url: "http://127.0.0.1:1",
      protocolVersion: incompatible ? HOST_PROTOCOL_VERSION + 1 : HOST_PROTOCOL_VERSION,
      serviceContractVersion: HOST_SERVICE_CONTRACT_VERSION, applicationVersion: "fixture", token, controlToken }, lease);
    const registry = join(state, ".host", "registry.json"), original = readFileSync(registry);
    const result = await oneShot(project, state);
    expect(result.exit).not.toBe(0); expect(result.result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(token); expect(JSON.stringify(result)).not.toContain(controlToken);
    expect(existsSync(config)).toBe(false); expect(readFileSync(registry)).toEqual(original);
    expect(store.readOwner("owner")?.instanceId).toBe(lease.instanceId);
  } finally { lease.release(); cleanup(project); }
}, 15000);

test("one-shot local MCP management works with an idle Host and retains its project directory", async () => {
  const { project, state, config } = fixture();
  const oldProject = process.env.WHYJ_TEST_PROJECT, oldPi = process.env.PI_CODING_AGENT_DIR;
  process.env.WHYJ_TEST_PROJECT = project; process.env.PI_CODING_AGENT_DIR = join(project, "pi-user");
  let connection: Awaited<ReturnType<typeof connectWorkspaceHost>> | undefined;
  try {
    connection = await connectWorkspaceHost({ workspaceRoot: state, entrypoint: join(import.meta.dir, "fixtures/resource-host.ts"), timeoutMs: 10000 });
    const entry = createHostRuntimeStore(state).read()!;
    const result = await oneShot(project, state);
    expect(result.exit).toBe(0); expect(result.result.ok).toBe(true); expect(result.stderr).toBe("");
    expect(readFileSync(config, "utf8")).toContain("tushare");
    expect(createHostRuntimeStore(state).read()?.instanceId).toBe(connection.instanceId);
    expect(hostProcessState(entry.pid)).toBe("alive");
    const before = readFileSync(config), otherProject = join(project, "other-project"); mkdirSync(otherProject);
    const other = await oneShot(otherProject, state);
    expect(other.exit).not.toBe(0); expect(other.result.ok).toBe(false);
    expect(existsSync(join(otherProject, ".pi", "mcp.json"))).toBe(false);
    expect(readFileSync(config)).toEqual(before);
  } finally {
    let stopped = true;
    if (connection) {
      const entry = createHostRuntimeStore(state).read(); await stopWorkspaceHost(connection);
      for (let n = 0; entry && n < 400 && hostProcessState(entry.pid) !== "dead"; n++) await Bun.sleep(20);
      stopped = !entry || hostProcessState(entry.pid) === "dead";
    }
    if (oldProject === undefined) delete process.env.WHYJ_TEST_PROJECT; else process.env.WHYJ_TEST_PROJECT = oldProject;
    if (oldPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldPi;
    if (stopped) cleanup(project);
    expect(stopped).toBe(true);
  }
}, 20000);

test("one-shot local MCP mutation cannot bypass a Host with active research", async () => {
  const { project, state, config } = fixture();
  const oldProject = process.env.WHYJ_TEST_PROJECT, oldPi = process.env.PI_CODING_AGENT_DIR, oldProxy = process.env.NO_PROXY, oldSkills = process.env.OHQUANT_SKILLS_DIR;
  process.env.WHYJ_TEST_PROJECT = project; process.env.PI_CODING_AGENT_DIR = join(project, "pi-user"); process.env.NO_PROXY = "127.0.0.1,localhost";
  process.env.OHQUANT_SKILLS_DIR = join(project, "shared-skills");
  const skill = join(project, "shared-skills", "fixture-repo", "skills", "fixture-skill"); mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "---\nname: fixture-skill\ndescription: Isolated resource fixture\n---\nfixture\n");
  let calls = 0;
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    await request.json(); calls++;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(": held\n\n")); } }), { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.provider = "custom"; settings.model = "boundary-fixture"; settings.thinkingLevel = "off";
  settings.providers = { custom: { baseUrl: model.url.origin + "/v1", api: "openai-completions", apiKey: "synthetic-fixture" } };
  writeFileSync(join(state, "settings.json"), JSON.stringify(settings));
  let connection: Awaited<ReturnType<typeof connectWorkspaceHost>> | undefined;
  let secondConnection: Awaited<ReturnType<typeof connectWorkspaceHost>> | undefined;
  try {
    connection = await connectWorkspaceHost({ workspaceRoot: state, entrypoint: join(import.meta.dir, "fixtures/resource-host.ts"), timeoutMs: 10000 });
    const rpc = async (method: string, ...args: unknown[]) => {
      const response = await fetch(connection!.url + "/api/workbench/rpc", { method: "POST", headers: { "content-type": "application/json", "x-workbench-token": connection!.token }, body: JSON.stringify({ method, args }) });
      const value = await response.json() as { result: any }; if (!response.ok) throw new Error("Fixture RPC failed: " + response.status); return value.result;
    };
    const identity = await rpc("identity"), snapshot = await rpc("session", identity.sessionId);
    const run = await rpc("submit", { workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: randomUUID(), expectedRevision: snapshot.revision, text: "Hold a synthetic research request." });
    for (let n = 0; n < 500 && calls === 0; n++) await Bun.sleep(10);
    expect(calls).toBe(1);
    const result = await oneShot(project, state);
    const current = await rpc("session", identity.sessionId);
    expect(current.state).toBe("running"); expect(current.identity.runId).toBe(run.runId); expect(calls).toBe(1);
    expect(result.exit).not.toBe(0); expect(result.result.ok).toBe(false); expect(existsSync(config)).toBe(false);
    const otherWorkspace = await oneShot(project, join(project, "other-state"), "/mcp install tushare");
    expect(otherWorkspace.exit).not.toBe(0); expect(otherWorkspace.result.ok).toBe(false);
    expect(existsSync(join(project, "pi-user", "mcp.json"))).toBe(false);
    const sharedSkill = await oneShot(project, join(project, "other-state"), "/skill remove fixture-skill");
    expect(sharedSkill.exit).not.toBe(0); expect(sharedSkill.result.ok).toBe(false);
    expect(existsSync(join(skill, "SKILL.md"))).toBe(true);
    expect(existsSync(join(project, "shared-skills", ".selection.json"))).toBe(false);
    const otherState = join(project, "other-state"); mkdirSync(join(otherState, "assets"), { recursive: true });
    writeFileSync(join(otherState, "assets", "index.html"), "<html><body>Fixture</body></html>");
    writeFileSync(join(otherState, "settings.json"), JSON.stringify(settings));
    secondConnection = await connectWorkspaceHost({ workspaceRoot: otherState, entrypoint: join(import.meta.dir, "fixtures/resource-host.ts"), timeoutMs: 10000 });
    const rpcOther = async (method: string, ...args: unknown[]) => {
      const response = await fetch(secondConnection!.url + "/api/workbench/rpc", { method: "POST", headers: { "content-type": "application/json", "x-workbench-token": secondConnection!.token }, body: JSON.stringify({ method, args }) });
      const value = await response.json() as { result: any }; if (!response.ok) throw new Error("Second fixture RPC failed: " + response.status); return value.result;
    };
    const identity2 = await rpcOther("identity"), snapshot2 = await rpcOther("session", identity2.sessionId);
    const run2 = await rpcOther("submit", { workspaceId: identity2.workspaceId, sessionId: identity2.sessionId, requestId: randomUUID(), expectedRevision: snapshot2.revision, text: "Hold another independent synthetic request." });
    for (let n = 0; n < 500 && calls < 2; n++) await Bun.sleep(10);
    expect(calls).toBe(2);
    await rpc("cancel", { workspaceId: identity.workspaceId, ...run });
    for (let n = 0; n < 500 && (await rpc("session", identity.sessionId)).state === "running"; n++) await Bun.sleep(10);
    const afterFirst = await oneShot(project, state, "/mcp install tushare");
    expect(afterFirst.exit).not.toBe(0); expect(existsSync(join(project, "pi-user", "mcp.json"))).toBe(false);
    expect((await rpcOther("session", identity2.sessionId)).state).toBe("running");
    await rpcOther("cancel", { workspaceId: identity2.workspaceId, ...run2 });
    for (let n = 0; n < 500 && (await rpcOther("session", identity2.sessionId)).state === "running"; n++) await Bun.sleep(10);
    const afterBoth = await oneShot(project, state, "/mcp install tushare");
    expect(afterBoth.exit).toBe(0); expect(readFileSync(join(project, "pi-user", "mcp.json"), "utf8")).toContain("tushare");
    const removeSkill = await oneShot(project, state, "/skill remove fixture-skill");
    expect(removeSkill.exit).toBe(0);
    expect(JSON.parse(readFileSync(join(project, "shared-skills", ".selection.json"), "utf8"))["fixture-repo"]).toEqual([]);
  } finally {
    let stopped = true;
    if (secondConnection) {
      const entry = createHostRuntimeStore(join(project, "other-state")).read(); await stopWorkspaceHost(secondConnection);
      for (let n = 0; entry && n < 400 && hostProcessState(entry.pid) !== "dead"; n++) await Bun.sleep(20);
      stopped = !entry || hostProcessState(entry.pid) === "dead";
    }
    if (connection) {
      const entry = createHostRuntimeStore(state).read(); await stopWorkspaceHost(connection);
      for (let n = 0; entry && n < 400 && hostProcessState(entry.pid) !== "dead"; n++) await Bun.sleep(20);
      stopped = stopped && (!entry || hostProcessState(entry.pid) === "dead");
    }
    await model.stop(true);
    if (oldProject === undefined) delete process.env.WHYJ_TEST_PROJECT; else process.env.WHYJ_TEST_PROJECT = oldProject;
    if (oldPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldPi;
    if (oldProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = oldProxy;
    if (oldSkills === undefined) delete process.env.OHQUANT_SKILLS_DIR; else process.env.OHQUANT_SKILLS_DIR = oldSkills;
    if (stopped) cleanup(project);
    expect(stopped).toBe(true);
  }
}, 30000);
