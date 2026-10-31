import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { connect as connectSocket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { acquireResourceLeases, artifactReference, createHostRuntimeStore, createWorkbenchSessionStore, hostProcessState, saveArtifact } from "../../../src/storage/index.ts";
import { generateArtifact } from "../../../src/artifact/src/generator.ts";
import { editPortfolio } from "../../../src/runtime/research/portfolio.ts";
import { stopWorkspaceHost } from "../../../src/app/bootstrap.ts";
import { DEFAULT_SETTINGS } from "../../../src/types/config.ts";
import type { SessionSnapshot, WorkspaceIdentity } from "../../../src/types/workbench.ts";
import type { TerminalReferenceResult } from "../../../src/types/terminal.ts";

// Run after build. A copied package outside the checkout catches source-relative
// paths and inherited cwd assumptions that source-only bootstrap tests miss.
const project = resolve(import.meta.dir, "../../..");
const temporary = mkdtempSync(join(tmpdir(), "whyj-cli-host-smoke-"));
const workspace = join(temporary, "workspace");
const registry = createHostRuntimeStore(workspace);
const packageDir = join(temporary, "package");
const nodeExecutable = process.env.WHYJ_NODE_EXECUTABLE || Bun.which("node");
assert.ok(nodeExecutable, "Node is required to verify the installed CLI contract.");
const launchEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["path", "whyj_bun_executable"].includes(key.toLowerCase())));
const modelRequests: Array<{ tools: Array<{ function: { name: string } }>; messages: unknown }> = [];
let holdNextModel = false, queuedModelStarted = () => {}, releaseQueuedModel = () => {};
let queuedModelGate = Promise.resolve();
const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  modelRequests.push(await request.json() as (typeof modelRequests)[number]);
  if (holdNextModel) { holdNextModel = false; queuedModelStarted(); await queuedModelGate; }
  const chunk = { id: "package-fixture", object: "chat.completion.chunk", created: 0, model: "package-fixture" };
  return new Response([{ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "Packaged terminal research completed." }, finish_reason: null }] },
    { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }].map(value => "data: " + JSON.stringify(value) + "\n\n").join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } });
} });
const settings = structuredClone(DEFAULT_SETTINGS);
settings.provider = "custom"; settings.model = "package-fixture"; settings.thinkingLevel = "off";
settings.providers = { custom: { baseUrl: model.url.origin + "/v1", api: "openai-completions", apiKey: "isolated-package-fixture" } };
let cleaned = false;
async function launch(executable: string, entry: string) {
  const child = Bun.spawn([executable, entry, "--json", "web", "--no-open"], {
    cwd: temporary, env: { ...launchEnvironment, PATH: temporary, OHQUANT_DIR: workspace, WHYJ_WEB_PORT: "0", NO_PROXY: "127.0.0.1,localhost" },
    stdout: "pipe", stderr: "pipe", timeout: 25000,
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  assert.equal(code, 0, stderr || stdout);
  assert.equal(stderr, "");
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.command, "web");
  assert.equal(result.data.browserOpened, false);
  assert.equal("token" in result.data, false);
  return result.data as { instanceId: string; workspaceId: string; url: string; started: boolean };
}
try {
  const skillDirectory = join(temporary, ".agents", "skills", "packaged-fixture");
  mkdirSync(skillDirectory, { recursive: true });
  writeFileSync(join(skillDirectory, "SKILL.md"), "---\nname: packaged-fixture\ndescription: Isolated package verification fixture.\n---\nExplain the PACKAGE_SKILL_CONTENT fixture using text only. Never execute tools.\n");
  writeFileSync(join(temporary, "reference-fixture.txt"), "PACKAGE_REFERENCE_CONTENT");
  writeFileSync(join(workspace, "settings.json"), JSON.stringify(settings));
  cpSync(join(project, "dist"), join(packageDir, "dist"), { recursive: true });
  const entry = join(packageDir, "dist/index.js");
  const oneShotSkills = join(temporary, "one-shot-skills"), oneShotWorkspace = join(temporary, "one-shot-workspace"), oneShotProject = join(temporary, "one-shot-project");
  mkdirSync(oneShotProject);
  const oneShot = async (command = "/skill catalog") => {
    const child = Bun.spawn([nodeExecutable, entry, "--json", "-c", command], { cwd: oneShotProject,
      env: { ...launchEnvironment, PATH: temporary, OHQUANT_DIR: oneShotWorkspace, OHQUANT_SKILLS_DIR: oneShotSkills,
        PI_CODING_AGENT_DIR: join(temporary, "one-shot-pi") }, stdout: "pipe", stderr: "pipe", timeout: 15000 });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    assert.equal(stderr, ""); return { code, value: JSON.parse(stdout) };
  };
  const writer = await acquireResourceLeases([oneShotSkills], "write");
  try { const blocked = await oneShot(); assert.notEqual(blocked.code, 0); assert.equal(blocked.value.ok, false); }
  finally { await writer(); }
  const allowed = await oneShot(); assert.equal(allowed.code, 0); assert.equal(allowed.value.ok, true);
  const mcpWriter = await acquireResourceLeases([join(temporary, "one-shot-pi")], "write");
  try {
    for (const command of ["/mcp list --local", "/mcp install tushare --local"]) {
      const blocked = await oneShot(command); assert.notEqual(blocked.code, 0); assert.equal(blocked.value.ok, false);
    }
  } finally { await mcpWriter(); }
  const mcpAllowed = await oneShot("/mcp install tushare --local"); assert.equal(mcpAllowed.code, 0); assert.equal(mcpAllowed.value.ok, true);
  const [first, second] = await Promise.all([launch(nodeExecutable, entry), launch(nodeExecutable, entry)]);
  assert.equal(first.instanceId, second.instanceId);
  assert.equal(first.workspaceId, second.workspaceId);
  assert.equal(Number(first.started) + Number(second.started), 1);
  const response = await fetch(first.url, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="root"/);
  const script = html.match(/src="([^"]+\.js)"/)?.[1]; assert.ok(script);
  const scriptResponse = await fetch(new URL(script, first.url), { method: "HEAD" });
  assert.equal(scriptResponse.status, 200); assert.match(scriptResponse.headers.get("content-type")!, /javascript/);
  assert.equal(await scriptResponse.text(), "");
  const source = await launch(process.execPath, join(project, "src/index.ts"));
  assert.equal(source.instanceId, first.instanceId);
  assert.equal(source.started, false);
  const registration = registry.read()!;
  assert.equal(registration.serviceContractVersion, 4);
  const headers = { "content-type": "application/json", "x-workbench-token": registration.token, "x-host-instance-id": registration.instanceId };
  assert.equal((await fetch(first.url + "/api/host/ready")).status, 401);
  assert.equal((await fetch(first.url + "/api/host/ready", { headers: { ...headers, origin: "https://foreign.invalid" } })).status, 403);
  assert.equal((await fetch(first.url + "/api/host/ready", { headers: { ...headers, "x-host-instance-id": "obsolete-instance" } })).status, 409);
  const smokeRpcRequest = async <T>(phase: string, operation: () => Promise<T>): Promise<T> => {
    try { return await operation(); }
    catch (error) {
      // Diagnostics must not expose the request or replace the original failure.
      try {
        const host = hostProcessState(registration.pid);
        console.error(JSON.stringify({ diagnostic: "packaged-rpc", phase, host, modelRequests: modelRequests.length }));
      } catch { /* Preserve the original transport error. */ }
      throw error;
    }
  };
  for (const streaming of [false, true]) {
    const oversized = new Uint8Array(32769).fill(32);
    const body = streaming ? new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(oversized.subarray(0, 16000)); controller.enqueue(oversized.subarray(16000)); controller.close();
    } }) : oversized;
    const rejected = await smokeRpcRequest(streaming ? "oversized-stream" : "oversized-buffer", () =>
      fetch(first.url + "/api/workbench/rpc", { method: "POST", headers, body }));
    assert.equal(rejected.status, 413);
  }
  assert.equal(modelRequests.length, 0);
  await new Promise<void>((resolve, reject) => {
    const socket = connectSocket(Number(new URL(first.url).port), "127.0.0.1");
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.write(`POST /api/workbench/rpc HTTP/1.1\r\nHost: ${new URL(first.url).host}\r\nContent-Length: 1000\r\nContent-Type: application/json\r\n\r\n{`);
      setTimeout(() => { socket.destroy(); resolve(); }, 30);
    });
  });
  assert.equal((await fetch(first.url + "/api/host/ready", { headers })).status, 200);
  const eventConnection = new AbortController();
  const events = await fetch(first.url + "/api/workbench/events", { headers, signal: AbortSignal.any([eventConnection.signal, AbortSignal.timeout(15000)]) });
  assert.equal(events.status, 200);
  const reader = events.body!.getReader(), decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /"type":"ready"/);
  async function rpc<T>(method: string, ...args: unknown[]): Promise<T> {
    return smokeRpcRequest(`rpc:${method}`, async () => {
      const response = await fetch(first.url + "/api/workbench/rpc", { method: "POST", headers, body: JSON.stringify({ method, args }), signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      return (await response.json() as { result: T }).result;
    });
  }
  const identity = await rpc<WorkspaceIdentity>("identity"), initial = await rpc<SessionSnapshot>("session", identity.sessionId);
  const terminalInput = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: "package-terminal-once", expectedRevision: initial.revision, text: "Reply about @file:reference-fixture.txt with text only; do not call tools." };
  const body = JSON.stringify({ instanceId: registration.instanceId, method: "submit", input: terminalInput });
  assert.equal((await fetch(first.url + "/api/host/terminal", { method: "POST", headers, body })).status, 403);
  const submitted = await fetch(first.url + "/api/host/terminal", { method: "POST", headers: { ...headers, "x-host-control-token": registration.controlToken }, body });
  assert.equal(submitted.status, 200);
  const receipt = (await submitted.json() as { result: { runId: string } }).result;
  async function settled() {
    const deadline = Date.now() + 15000;
    for (;;) {
      const state = await rpc<SessionSnapshot>("session", identity.sessionId);
      if (state.state !== "running") { assert.equal(state.state, "settled", JSON.stringify(state.turns)); return state; }
      assert.ok(Date.now() < deadline, "Packaged research did not finish"); await delay(25);
    }
  }
  const completed = await settled();
  let observed = "";
  while (!observed.includes('"state":"settled"')) {
    const next = await reader.read(); assert.equal(next.done, false); observed += decoder.decode(next.value);
  }
  assert.ok(observed.includes(receipt.runId)); assert.ok(!observed.includes(registration.controlToken));
  eventConnection.abort(); await reader.cancel(); reader.releaseLock();
  let detached = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const status = await (await fetch(first.url + "/api/host/status", { headers })).json() as { observers: number };
    if (status.observers === 0) { detached = true; break; } await delay(10);
  }
  assert.ok(detached, "Disconnect must release the Node SSE subscription.");
  assert.equal(completed.identity.runId, receipt.runId);
  assert.match(completed.turns.at(-1)!.text, /Packaged terminal research completed/);
  assert.equal(modelRequests.length, 1);
  assert.ok(modelRequests[0]!.tools.some(tool => tool.function.name === "bash"));
  const compacted = await fetch(first.url + "/api/host/terminal", { method: "POST", headers: { ...headers, "x-host-control-token": registration.controlToken },
    body: JSON.stringify({ instanceId: registration.instanceId, method: "command", input: { ...terminalInput,
      requestId: "package-compact-once", expectedRevision: completed.revision, text: "/compact Preserve the research goal" } }), signal: AbortSignal.timeout(15000) });
  assert.equal(compacted.status, 200);
  const compactReceipt = (await compacted.json() as { result: { sessionId: string; revision: number; result: { success: boolean; message: string } } }).result;
  assert.equal(compactReceipt.sessionId, identity.sessionId); assert.equal(compactReceipt.result.success, true);
  assert.match(compactReceipt.result.message, /Compacted/); assert.equal(modelRequests.length, 2);
  await rpc("submit", { ...terminalInput, requestId: "package-browser-once", expectedRevision: compactReceipt.revision, text: "Continue with text only from the browser." });
  await settled();
  assert.equal(modelRequests.length, 3);
  assert.ok(!modelRequests[2]!.tools.some(tool => tool.function.name === "bash"));
  assert.match(JSON.stringify(modelRequests[2]!.messages), /Packaged terminal research completed/);
  const coreId = createWorkbenchSessionStore(join(workspace, "workbench/sessions")).load(identity.workspaceId, identity.sessionId).record.coreSessionId;
  const other = await rpc<{ sessionId: string }>("createSession");
  const resumed = await fetch(first.url + "/api/host/terminal", { method: "POST", headers: { ...headers, "x-host-control-token": registration.controlToken },
    body: JSON.stringify({ instanceId: registration.instanceId, method: "command", input: { ...terminalInput,
      sessionId: other.sessionId, requestId: "package-resume-once", expectedRevision: 0, text: `/resume ${coreId}` } }), signal: AbortSignal.timeout(15000) });
  assert.equal(resumed.status, 200);
  const resumeReceipt = (await resumed.json() as { result: { selectedSessionId: string; result: { success: boolean; message: string } } }).result;
  assert.equal(resumeReceipt.selectedSessionId, identity.sessionId); assert.equal(resumeReceipt.result.success, true);
  assert.match(resumeReceipt.result.message, /Resumed/); assert.equal(modelRequests.length, 3);
  const contextBody = JSON.stringify({ instanceId: registration.instanceId, method: "context", input: { workspaceId: identity.workspaceId, sessionId: identity.sessionId } });
  assert.equal((await fetch(first.url + "/api/host/terminal", { method: "POST", headers, body: contextBody })).status, 403);
  const contextResponse = await fetch(first.url + "/api/host/terminal", { method: "POST", headers: { ...headers, "x-host-control-token": registration.controlToken }, body: contextBody });
  assert.equal(contextResponse.status, 200);
  const context = (await contextResponse.json() as { result: { coreSessionId: string; messages: unknown[]; thinkingText: string } }).result;
  assert.equal(context.coreSessionId, coreId); assert.equal(context.thinkingText, "");
  assert.match(JSON.stringify(context.messages), /Packaged terminal research completed/); assert.equal(modelRequests.length, 3);
  assert.match(JSON.stringify(modelRequests[0]!.messages), /PACKAGE_REFERENCE_CONTENT/);
  assert.doesNotMatch(JSON.stringify(context.messages), /PACKAGE_REFERENCE_CONTENT/);
  const skillSnapshot = await rpc<SessionSnapshot>("session", identity.sessionId);
  const skillBody = JSON.stringify({ instanceId: registration.instanceId, method: "command", input: { ...terminalInput,
    requestId: "package-skill-once", expectedRevision: skillSnapshot.revision, text: "/skill:packaged-fixture Explain the package fixture" } });
  const skillResponse = await fetch(first.url + "/api/host/terminal", { method: "POST", headers: { ...headers, "x-host-control-token": registration.controlToken }, body: skillBody });
  assert.equal(skillResponse.status, 200);
  const skillReceipt = (await skillResponse.json() as { result: { result: { success: boolean } } }).result;
  assert.equal(skillReceipt.result.success, true); assert.equal(modelRequests.length, 4);
  const management = [
    ["/skill list", /packaged-fixture/],
    ["/skill info packaged-fixture", /Isolated package verification fixture/],
    ["/skill reload", /packaged-fixture/],
    ["/skill install", /nothing is downloaded/],
    ["/config --extensions list", /whyj.core 1.0.0 · enabled/],
    ["/config --extensions disable whyj.core", /whyj.core 1.0.0 · disabled/],
    ["/config --extensions enable whyj.core", /whyj.core 1.0.0 · enabled/],
    ["/config --extensions reload whyj.core", /whyj.core 1.0.0 · enabled/],
    ["/mcp export tushare", /YOUR_TUSHARE_TOKEN/],
  ] as const;
  for (const [index, [text, expected]] of management.entries()) {
    const current = await rpc<SessionSnapshot>("session", identity.sessionId);
    const body = JSON.stringify({ instanceId: registration.instanceId, method: "command", input: { ...terminalInput,
      requestId: `package-management-${index}`, expectedRevision: current.revision, text } });
    assert.equal((await fetch(first.url + "/api/host/terminal", { method: "POST", headers, body })).status, 403);
    const response = await fetch(first.url + "/api/host/terminal", { method: "POST", headers: { ...headers, "x-host-control-token": registration.controlToken }, body });
    assert.equal(response.status, 200);
    const result = (await response.json() as { result: { result: { success: boolean; message: string } } }).result.result;
    assert.equal(result.success, true); assert.match(result.message, expected);
    assert.equal((await rpc<SessionSnapshot>("session", identity.sessionId)).revision, current.revision);
  }
  assert.equal(modelRequests.length, 4);
  assert.match(JSON.stringify(modelRequests[3]!.messages), /PACKAGE_SKILL_CONTENT/);
  assert.equal(createWorkbenchSessionStore(join(workspace, "workbench/sessions")).load(identity.workspaceId, identity.sessionId).record.coreSessionId, coreId);
  const privateCall = async (method: string, input: unknown) => fetch(first.url + "/api/host/terminal", {
    method: "POST", headers: { ...headers, "x-host-control-token": registration.controlToken },
    body: JSON.stringify({ instanceId: registration.instanceId, method, input }),
  });
  const journals = () => readdirSync(join(workspace, "sessions"), { recursive: true }).filter(path => String(path).endsWith(".jsonl"))
    .map(path => [String(path), readFileSync(join(workspace, "sessions", String(path)), "utf8")]).sort(([a], [b]) => a!.localeCompare(b!));
  const beforeReferences = journals(), referenceCalls = modelRequests.length;
  assert.equal(beforeReferences.length, 1);
  const selectedReferences = await rpc<SessionSnapshot>("session", identity.sessionId);
  const referenceInput = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, input: "@file:reference-fixture" };
  const referenceBody = JSON.stringify({ instanceId: registration.instanceId, method: "suggestReferences", input: referenceInput });
  assert.equal((await fetch(first.url + "/api/host/terminal", { method: "POST", headers, body: referenceBody })).status, 403);
  assert.equal((await fetch(first.url + "/api/workbench/rpc", { method: "POST", headers,
    body: JSON.stringify({ method: "suggestReferences", args: [referenceInput] }) })).status, 404);
  for (const [query, kind, fill] of [[referenceInput.input, "file", "@file:reference-fixture.txt "],
    [`@session:${coreId}`, "session", `@session:${coreId} `]] as const) {
    const response = await privateCall("suggestReferences", { ...referenceInput, input: query });
    assert.equal(response.status, 200);
    const result = (await response.json() as { result: TerminalReferenceResult }).result;
    assert.equal(result.workspaceId, identity.workspaceId); assert.equal(result.sessionId, identity.sessionId);
    assert.equal(result.runId, selectedReferences.identity.runId);
    assert.ok(result.items.some(item => item.kind === kind && item.fill === fill));
  }
  const noEvidence = await privateCall("suggestReferences", { ...referenceInput, input: "@evidence:no-such-tool" });
  assert.equal(noEvidence.status, 200); assert.deepEqual((await noEvidence.json() as { result: TerminalReferenceResult }).result.items, []);
  assert.equal(modelRequests.length, referenceCalls); assert.deepEqual(journals(), beforeReferences);
  assert.equal((await rpc<SessionSnapshot>("session", identity.sessionId)).revision, selectedReferences.revision);
  const queueStarted = new Promise<void>(resolve => { queuedModelStarted = resolve; });
  queuedModelGate = new Promise<void>(resolve => { releaseQueuedModel = resolve; }); holdNextModel = true;
  const beforeQueue = await rpc<SessionSnapshot>("session", identity.sessionId), beforeCalls = modelRequests.length;
  const queueRunResponse = await privateCall("submit", { ...terminalInput, requestId: "package-queue-run", expectedRevision: beforeQueue.revision, text: "Hold this fixture response for queue verification." });
  assert.equal(queueRunResponse.status, 200);
  const queueRun = (await queueRunResponse.json() as { result: { sessionId: string; runId: string } }).result;
  await Promise.race([queueStarted, delay(10000).then(() => { throw new Error("Packaged queue model did not start"); })]);
  const queuedInput = { workspaceId: identity.workspaceId, ...queueRun, requestId: "package-queued-once", text: "Queued package input @file:reference-fixture.txt" };
  const queueResponse = await privateCall("enqueue", queuedInput); assert.equal(queueResponse.status, 200);
  const queuedReceipt = (await queueResponse.json() as { result: unknown }).result;
  assert.deepEqual(queuedReceipt, { workspaceId: identity.workspaceId, ...queueRun, requestId: queuedInput.requestId, mode: "followUp" });
  assert.deepEqual((await (await privateCall("enqueue", queuedInput)).json() as { result: unknown }).result, queuedReceipt);
  const queuedContext = (await (await privateCall("context", { workspaceId: identity.workspaceId, sessionId: identity.sessionId })).json() as { result: { composerQueue: string[]; activeModel: { id: string; label: string } | null } }).result;
  assert.deepEqual(queuedContext.composerQueue, [queuedInput.text]);
  assert.equal(queuedContext.activeModel?.id, "package-fixture");
  assert.doesNotMatch(JSON.stringify(queuedContext.activeModel), /isolated-package-fixture|baseUrl|apiKey/);
  assert.doesNotMatch(JSON.stringify(await rpc<SessionSnapshot>("session", identity.sessionId)), /Queued package input/);
  releaseQueuedModel();
  let drained = await rpc<SessionSnapshot>("session", identity.sessionId);
  for (let attempt = 0; attempt < 200 && drained.state === "running"; attempt++) { await delay(25); drained = await rpc<SessionSnapshot>("session", identity.sessionId); }
  assert.equal(drained.state, "settled"); assert.equal(drained.identity.runId, queueRun.runId);
  assert.equal(modelRequests.length, beforeCalls + 2); assert.match(JSON.stringify(modelRequests.at(-1)!.messages), /PACKAGE_REFERENCE_CONTENT/);
  const drainedContext = (await (await privateCall("context", { workspaceId: identity.workspaceId, sessionId: identity.sessionId })).json() as { result: { composerQueue: string[]; activeModel: unknown; turnCount: number; contextUsage: { tokens: number } | null; latency: { ttftMs: number | null; tpotMs: number | null }; messages: Array<{ role: string; text?: string }> } }).result;
  assert.deepEqual(drainedContext.composerQueue, []);
  assert.equal(drainedContext.activeModel, null);
  assert.ok(Number.isSafeInteger(drainedContext.turnCount) && drainedContext.turnCount > 0);
  assert.ok(drainedContext.contextUsage && Number.isFinite(drainedContext.contextUsage.tokens) && drainedContext.contextUsage.tokens >= 0);
  assert.ok(drainedContext.latency.ttftMs !== null && Number.isFinite(drainedContext.latency.ttftMs) && drainedContext.latency.ttftMs >= 0);
  assert.doesNotMatch(JSON.stringify(drainedContext.latency), /isolated-package-fixture|baseUrl|apiKey/);
  assert.equal(drainedContext.messages.filter(message => message.role === "user" && message.text === queuedInput.text).length, 1);
  assert.equal(createWorkbenchSessionStore(join(workspace, "workbench/sessions")).load(identity.workspaceId, identity.sessionId).record.coreSessionId, coreId);
  const reportFiles = journals(); assert.equal(reportFiles.length, 1);
  const generated = generateArtifact({ sessionPath: join(workspace, "sessions", reportFiles[0]![0]!) }); assert.ok(generated);
  const oldOhquant = process.env.OHQUANT_DIR;
  let reportId: string;
  try {
    process.env.OHQUANT_DIR = workspace;
    reportId = artifactReference(saveArtifact(generated.sessionId, generated.html, { title: generated.title,
      messageCount: generated.messageCount, sourceSessionId: generated.sessionId, provenance: generated.provenance }));
  } finally { if (oldOhquant === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = oldOhquant; }
  const beforeRestore = await rpc<SessionSnapshot>("session", identity.sessionId), restoreCalls = modelRequests.length;
  const restoreInput = { workspaceId: identity.workspaceId, sessionId: identity.sessionId,
    requestId: "package-restore-report", expectedRevision: beforeRestore.revision, reportId };
  const restoreBody = JSON.stringify({ instanceId: registration.instanceId, method: "restoreReport", input: restoreInput });
  assert.equal((await fetch(first.url + "/api/host/terminal", { method: "POST", headers, body: restoreBody })).status, 403);
  assert.equal((await fetch(first.url + "/api/workbench/rpc", { method: "POST", headers,
    body: JSON.stringify({ method: "restoreReport", args: [restoreInput] }) })).status, 404);
  const restoreResponse = await privateCall("restoreReport", restoreInput); assert.equal(restoreResponse.status, 200);
  const restored = (await restoreResponse.json() as { result: { selectedSessionId: string; filePath: string; result: { success: boolean } } }).result;
  assert.equal(restored.result.success, true); assert.equal(restored.selectedSessionId, identity.sessionId);
  assert.equal(readFileSync(restored.filePath, "utf8"), generated.html);
  assert.equal((await rpc<SessionSnapshot>("session", identity.sessionId)).revision, beforeRestore.revision! + 2);
  assert.equal(modelRequests.length, restoreCalls); assert.equal(journals().length, 1);
  assert.equal(createWorkbenchSessionStore(join(workspace, "workbench/sessions")).load(identity.workspaceId, identity.sessionId).record.coreSessionId, coreId);
  const beforeTask = await rpc<SessionSnapshot>("session", identity.sessionId), taskCalls = modelRequests.length;
  const task = { id: "package-task", request: "Research AAPL for this isolated package task.", goal: "Verify the fixed task context",
    scope: { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
    constraints: { allowedTools: ["run_backtest"], notes: ["No trades"] }, dataRefs: [], reportRequired: false,
    criteria: [{ id: "return", description: "Original parameter return", tool: "run_backtest",
      parameters: { symbol: "AAPL", fast: 1, slow: 2, cash: 1000, commission: 0, start: "2026-01-01", end: "2026-02-09" }, metrics: ["Total return"] }] };
  const taskInput = { workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: "package-task-once",
    expectedRevision: beforeTask.revision, expectedTaskRevision: null, task };
  const taskBody = JSON.stringify({ instanceId: registration.instanceId, method: "submitResearch", input: taskInput });
  assert.equal((await fetch(first.url + "/api/host/terminal", { method: "POST", headers, body: taskBody })).status, 403);
  assert.equal((await fetch(first.url + "/api/workbench/rpc", { method: "POST", headers,
    body: JSON.stringify({ method: "submitResearch", args: [taskInput] }) })).status, 404);
  const taskResponse = await privateCall("submitResearch", taskInput); assert.equal(taskResponse.status, 200);
  const taskReceipt = (await taskResponse.json() as { result: { sessionId: string; runId: string } }).result;
  let finishedTask = await rpc<SessionSnapshot>("session", identity.sessionId);
  for (let attempt = 0; attempt < 200 && finishedTask.state === "running"; attempt++) { await delay(25); finishedTask = await rpc<SessionSnapshot>("session", identity.sessionId); }
  assert.equal(finishedTask.state, "settled"); assert.equal(finishedTask.identity.runId, taskReceipt.runId);
  assert.equal(modelRequests.length, taskCalls + 1); assert.match(JSON.stringify(modelRequests.at(-1)), /Verify the fixed task context/);
  assert.deepEqual((await (await privateCall("submitResearch", taskInput)).json() as { result: unknown }).result, taskReceipt);
  const inspectTask = await privateCall("command", { workspaceId: identity.workspaceId, sessionId: identity.sessionId,
    requestId: "package-task-inspect", expectedRevision: finishedTask.revision, text: "/resume --task" });
  assert.equal(inspectTask.status, 200);
  assert.equal((await inspectTask.json() as { result: { result: { data: { task: { spec: { id: string } } } } } }).result.result.data.task.spec.id, task.id);
  assert.equal(modelRequests.length, taskCalls + 1); assert.equal(journals().length, 1);
  const previousWorkspace = process.env.OHQUANT_DIR;
  try {
    process.env.OHQUANT_DIR = workspace;
    const firstGroup = editPortfolio({ type: "create", name: "Package first portfolio" }).groups.at(-1)!;
    editPortfolio({ type: "add", group: firstGroup.id, code: "AAPL" });
    const secondGroup = editPortfolio({ type: "create", name: "Package second portfolio" }).groups.at(-1)!;
    editPortfolio({ type: "add", group: secondGroup.id, code: "MSFT" }); editPortfolio({ type: "select", group: firstGroup.id });
    const portfolioStarted = new Promise<void>(resolve => { queuedModelStarted = resolve; });
    queuedModelGate = new Promise<void>(resolve => { releaseQueuedModel = resolve; }); holdNextModel = true;
    const prior = await rpc<SessionSnapshot>("session", identity.sessionId), calls = modelRequests.length;
    const response = await privateCall("submit", { workspaceId: identity.workspaceId, sessionId: identity.sessionId,
      requestId: "package-portfolio-run", expectedRevision: prior.revision, text: "Hold the selected portfolio research." });
    assert.equal(response.status, 200);
    const run = (await response.json() as { result: { sessionId: string; runId: string } }).result;
    await Promise.race([portfolioStarted, delay(10000).then(() => { throw new Error("Packaged portfolio model did not start"); })]);
    assert.match(JSON.stringify(modelRequests.at(-1)), /Package first portfolio/);
    assert.doesNotMatch(JSON.stringify(modelRequests.at(-1)), /Package second portfolio/);
    editPortfolio({ type: "select", group: secondGroup.id });
    let stopped = await rpc<SessionSnapshot>("session", identity.sessionId);
    for (let attempt = 0; attempt < 200 && stopped.state === "running"; attempt++) { await delay(25); stopped = await rpc<SessionSnapshot>("session", identity.sessionId); }
    assert.equal(stopped.state, "cancelled"); assert.equal(stopped.identity.runId, run.runId);
    assert.equal(modelRequests.length, calls + 1); releaseQueuedModel();
    assert.equal(journals().length, 1);
  } finally {
    releaseQueuedModel();
    if (previousWorkspace === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previousWorkspace;
  }
  const failedWorkspace = join(temporary, "failed-workspace");
  const failed = Bun.spawn([nodeExecutable, entry, "--json", "web", "--no-open"], {
    cwd: temporary, env: { ...process.env, OHQUANT_DIR: failedWorkspace, WHYJ_BUN_EXECUTABLE: join(temporary, "missing-bun"), WHYJ_WEB_PORT: "0" },
    stdout: "pipe", stderr: "pipe", timeout: 25000,
  });
  const [failedCode, failedOut, failedErr] = await Promise.all([failed.exited, new Response(failed.stdout).text(), new Response(failed.stderr).text()]);
  assert.equal(failedCode, 1);
  assert.equal(failedErr, "");
  assert.equal(JSON.parse(failedOut).error.code, "web_failed");
  const failedRegistry = createHostRuntimeStore(failedWorkspace);
  assert.equal(failedRegistry.read(), undefined);
  const occupiedWorkspace = join(temporary, "occupied-workspace");
  const occupied = Bun.spawn([nodeExecutable, entry, "--json", "web", "--no-open"], {
    cwd: temporary, env: { ...launchEnvironment, PATH: temporary, OHQUANT_DIR: occupiedWorkspace, WHYJ_WEB_PORT: new URL(first.url).port },
    stdout: "pipe", stderr: "pipe", timeout: 25000,
  });
  const [occupiedCode, occupiedOut, occupiedErr] = await Promise.all([occupied.exited, new Response(occupied.stdout).text(), new Response(occupied.stderr).text()]);
  assert.equal(occupiedCode, 1); assert.equal(occupiedErr, ""); assert.equal(JSON.parse(occupiedOut).error.code, "web_failed");
  const occupiedRegistry = createHostRuntimeStore(occupiedWorkspace);
  assert.equal(occupiedRegistry.read(), undefined); assert.equal(occupiedRegistry.readOwner("owner"), undefined);
  assert.equal(occupiedRegistry.readOwner("startup"), undefined);
  assert.equal(failedRegistry.readOwner("owner"), undefined);
  assert.equal(failedRegistry.readOwner("startup"), undefined);
  console.log(JSON.stringify({ packagedOneShotResourceRead: "pass", packagedMcpMixedScopes: "pass", concurrentPackagedLaunches: "pass", sourceReusesPackagedHost: "pass", builtAssets: "pass",
    packagedTerminalResearch: "pass", packagedTerminalCompact: "pass", packagedTerminalResume: "pass", packagedTerminalContext: "pass",
    packagedTerminalReferences: "pass", packagedTerminalReferenceSuggestions: "pass", packagedTerminalSkill: "pass", packagedTerminalManagement: "pass", packagedTerminalQueue: "pass", packagedTerminalActiveModel: "pass", packagedTerminalLatency: "pass", packagedTerminalContextUsage: "pass", packagedTerminalTurnCount: "pass", packagedTerminalReportRestore: "pass", packagedTerminalStructuredTask: "pass", packagedTerminalPortfolioSwitch: "pass", restrictedBrowserContinuation: "pass",
    nodeOnlyWithoutRuntimeOnPath: "pass", boundedHttpBodies: "pass", authenticatedSseDetach: "pass", nodePortFailureCleanup: "pass" }));
} finally {
  releaseQueuedModel();
  try {
  const entry = registry.read();
  if (entry && hostProcessState(entry.pid) !== "dead") {
    await stopWorkspaceHost({ ...entry, started: false });
    const deadline = Date.now() + 15000;
    while (hostProcessState(entry.pid) !== "dead" && Date.now() < deadline) await delay(25);
    assert.equal(hostProcessState(entry.pid), "dead", "Smoke Host did not exit; retain its isolated workspace.");
  }
  assert.equal(registry.read(), undefined);
  assert.equal(registry.readOwner("owner"), undefined);
  if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected smoke directory");
  rmSync(temporary, { recursive: true, force: true });
  cleaned = true;
  } finally { await model.stop(true); }
}
assert.equal(cleaned, true);
console.log("Explicit shutdown, process exit and metadata cleanup: pass");
