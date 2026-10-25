import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { AppRuntime, createInitialAppState } from "../../src/app-runtime.ts";
import { QuantTui } from "../../apps/tui/src/tui.ts";
import { RuntimeExtensions } from "../../src/runtime/extensions.ts";
import { loadSettings, resolveSkillsDir, saveSettings } from "../../src/storage/index.ts";
import { statisticsExtension } from "../../src/extensions/test/fixtures/statistics-extension.ts";
import type { QuantAgentSession } from "../../src/agent/src/session.ts";
import type { AppState, UIMessage } from "../../src/types/ui.ts";

let root: string, previous: string | undefined, noProxy: string | undefined;
let server: ReturnType<typeof Bun.serve>, runtime: AppRuntime | undefined;
let requests: Array<{ tools?: Array<{ function: { name: string } }>; messages: Array<{ role: string; content: unknown }> }>;
let release: (() => void) | undefined, entered: (() => void) | undefined, delay: boolean;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR; noProxy = process.env.NO_PROXY;
  root = mkdtempSync(join(tmpdir(), "whyj-app-extensions-"));
  process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  runtime = undefined; requests = []; delay = false; release = entered = undefined;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    requests.push(await request.json() as typeof requests[number]);
    if (delay) { const pending = new Promise<void>(resolve => { release = resolve; }); entered?.(); await pending; }
    const chunk = { id: "fixture", object: "chat.completion.chunk", created: 0, model: "extension-app", choices: [{ index: 0, delta: { role: "assistant", content: "Fixture response" }, finish_reason: "stop" }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  } });
  const settings = loadSettings(); settings.provider = "custom"; settings.model = "extension-app";
  settings.providers = { custom: { api: "openai-completions", baseUrl: `${server.url}v1`, apiKey: "fixture-key" } };
  saveSettings(settings);
});
afterEach(async () => {
  release?.(); await runtime?.shutdown(); server.stop(true);
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (noProxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = noProxy;
  const within = relative(realpathSync(tmpdir()), realpathSync(root));
  if (!within.startsWith("whyj-app-extensions-") || within.includes(sep)) throw new Error("Unsafe cleanup");
  rmSync(root, { recursive: true, force: true });
});

it("uses the managed core in default startup and updates actual Pi requests without replacing the session or refreshing prices", async () => {
  let quotes = 0, refreshed = 0;
  runtime = new AppRuntime({ onMessages() {}, onActivity() {}, onSkillsChanged() { refreshed++; } }, async () => { quotes++; return []; }, async () => [], undefined, undefined, undefined, undefined, 0);
  await runtime.bootstrap(); await runtime.refreshOverviewPanel();
  await runtime.submit("Remember this original discussion");
  const agent = (runtime as unknown as { agent: QuantAgentSession }).agent;
  const id = (await agent.getSessionMetadata())!.id;
  expect(requests.at(-1)!.tools!.map(tool => tool.function.name)).toContain("run_backtest");
  const before = quotes;
  await runtime.submit("/config --extensions disable whyj.core");
  expect(quotes).toBe(before); expect(refreshed).toBe(1);
  await runtime.submit("Continue with the current tools");
  expect(requests.at(-1)!.tools!.map(tool => tool.function.name)).toEqual(["research_task"]);
  expect(JSON.stringify(requests.at(-1)!.messages)).toContain("Current active tools: research_task.");
  expect(JSON.stringify(requests.at(-1)!.messages)).toContain("Remember this original discussion");
  await runtime.submit("/config --extensions enable whyj.core");
  await runtime.submit("/config --extensions reload whyj.core");
  await runtime.submit("Check restored availability");
  expect(requests.at(-1)!.tools!.map(tool => tool.function.name)).toContain("run_backtest");
  expect((await agent.getSessionMetadata())!.id).toBe(id);
  await runtime.shutdown();
  runtime = new AppRuntime({ onMessages() {}, onActivity() {} }, async () => [], async () => [], undefined, undefined, undefined, undefined, 0);
  const settings = loadSettings(); settings.disabledExtensions = ["whyj.core"]; saveSettings(settings);
  await runtime.bootstrap(); await runtime.submit("Start with the saved selection");
  expect(requests.at(-1)!.tools!.map(tool => tool.function.name)).toEqual(["research_task"]);
});

it("permits read-only inspection during a model turn but rejects capability changes explicitly", async () => {
  const statuses: AppState["composerStatus"][] = [];
  let messages: UIMessage[] = [];
  runtime = new AppRuntime({ onMessages(value) { messages = value; }, onActivity() {}, onComposerStatus(status) { statuses.push(status); } }, async () => [], async () => [], undefined, undefined, undefined, undefined, 0);
  await runtime.bootstrap(); delay = true;
  const received = new Promise<void>(resolve => { entered = resolve; });
  const turn = runtime.submit("Wait for fixture reply");
  await received;
  try {
    await runtime.submit("/config --extensions disable whyj.core");
    expect(statuses.at(-1)).toMatchObject({ kind: "error", text: expect.stringContaining("Wait") });
    expect(loadSettings().disabledExtensions).toBeUndefined();
    await runtime.submit("/config --extensions list");
    expect(JSON.stringify(messages)).toContain("whyj.core 1.0.0");
    expect(requests).toHaveLength(1);
  } finally { release?.(); await turn; }
});

it("cancels extension initialization during startup without publishing a ready agent", async () => {
  let initialized!: () => void;
  const pending = new Promise<void>(resolve => { initialized = resolve; });
  const manager = new RuntimeExtensions({ cwd: root, definitions: [{ manifest: { id: "fixture.pending", version: "1.0.0", apiVersion: 1, tools: [], skills: [], commands: [] },
    activate: ({ signal }) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); initialized(); }),
  }] });
  const activities: string[] = [];
  runtime = new AppRuntime({ onMessages() {}, onActivity(value) { activities.push(value); } }, async () => [], async () => [], undefined, undefined, undefined, undefined, 0, {}, manager);
  const boot = runtime.bootstrap().then(() => "started", () => "cancelled");
  await pending; await runtime.shutdown();
  expect(await boot).toBe("cancelled");
  expect(activities).not.toContain("ready"); expect(manager.host.snapshot().tools).toEqual([]);
  expect(requests).toEqual([]);
});

it("rejects an extension colliding with local skills before enabling it or changing the research session", async () => {
  const path = join(resolveSkillsDir(), "__extension-local-fixture__", "fixture-statistics");
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), "---\nname: fixture-statistics\ndescription: Local statistics fixture\n---\nLocal instructions");
  const settings = loadSettings(); settings.disabledExtensions = ["fixture.statistics"]; saveSettings(settings);
  let activated = false;
  const original = statisticsExtension();
  const manager = new RuntimeExtensions({ cwd: root, definitions: [{ ...original, activate(context) { activated = true; return original.activate(context); } }] });
  let messages: UIMessage[] = [];
  const statuses: AppState["composerStatus"][] = [];
  runtime = new AppRuntime({ onMessages(value) { messages = value; }, onActivity() {}, onComposerStatus(value) { statuses.push(value); } }, async () => [], async () => [], undefined, undefined, undefined, undefined, 0, {}, manager);
  await runtime.bootstrap(); await runtime.submit("Original session");
  await runtime.submit("/config --extensions enable fixture.statistics");
  expect(activated).toBe(false); expect(JSON.stringify([messages, statuses])).toContain("skills conflict");
  expect(loadSettings().disabledExtensions).toEqual(["fixture.statistics"]);
  await runtime.submit("Continue the original session");
  expect(JSON.stringify(requests.at(-1))).toContain("Original session");
  expect(requests.at(-1)!.tools!.map(tool => tool.function.name)).toEqual(["research_task"]);
});

it("refreshes actual Composer suggestions from the managed session when an extension is disabled and enabled", async () => {
  const manager = new RuntimeExtensions({ cwd: root, definitions: [statisticsExtension()] });
  const tui = new QuantTui(createInitialAppState("fixture"));
  let completion = Promise.resolve();
  runtime = new AppRuntime({ onMessages() {}, onActivity() {}, onSkillsChanged() { completion = tui.refreshSkills(() => runtime!.getSkillSuggestions()); } },
    async () => [], async () => [], undefined, undefined, undefined, undefined, 0, {}, manager);
  await runtime.bootstrap(); await tui.refreshSkills(() => runtime!.getSkillSuggestions());
  const input = tui as unknown as { inputBuf: string; currentSuggestions(): Array<{ fill: string }> };
  input.inputBuf = "/skill";
  expect(input.currentSuggestions().some(item => item.fill.includes("fixture-statistics"))).toBe(true);
  await runtime.submit("/config --extensions disable fixture.statistics"); await completion;
  expect(input.currentSuggestions().some(item => item.fill.includes("fixture-statistics"))).toBe(false);
  await runtime.submit("/config --extensions enable fixture.statistics"); await completion;
  expect(input.currentSuggestions().some(item => item.fill.includes("fixture-statistics"))).toBe(true);
  expect(requests).toEqual([]);
});
