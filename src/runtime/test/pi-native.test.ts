import { expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { nativePiArgs } from "../pi-launcher.ts";
import { projectResearchState } from "../../research/state.ts";

it("delegates package operations and preserves native arguments and explicit skill selection", () => {
  expect(nativePiArgs(["install", "ticker", "--local"], "quant.ts", ["chosen"])).toEqual(["install", "npm:@narumitw/pi-ticker@0.1.1", "--local"]);
  expect(nativePiArgs(["remove", "./my package"], "quant.ts", [])).toEqual(["remove", "./my package"]);
  expect(nativePiArgs(["config", "--local"], "quant.ts", ["chosen"])).toEqual(["config", "--local"]);
  expect(nativePiArgs(["--mode", "rpc", "--", "prompt"], "quant.ts", ["selected/SKILL.md"])).toEqual([
    "--extension", "quant.ts", "--skill", "selected/SKILL.md", "--mode", "rpc", "--", "prompt"]);
  expect(nativePiArgs(["--no-skills"], "quant.ts", ["removed"])).not.toContain("removed");
  expect(nativePiArgs(["-ns"], "quant.ts", ["removed"])).not.toContain("removed");
  expect(nativePiArgs(["--", "--no-skills"], "quant.ts", ["selected"])).toContain("selected");
});

it("runs native Pi with quant and community tools, persists task guards and resumes the same branch", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-native-pi-"));
  const agentDir = join(root, "agent"); mkdirSync(agentDir);
  const sessionFile = join(root, "session.jsonl");
  const community = join(root, "community.ts");
  writeFileSync(community, `export default function(pi) {
    pi.registerTool({name:'community_probe',label:'Probe',description:'Synthetic community tool',parameters:{type:'object',properties:{}},
      async execute(){return {content:[{type:'text',text:'community executed'}],details:{executed:true}}}});
  }`);
  const calls = ["read", "declare", "community_probe", "read", "cancel", "community_probe", "read"];
  const requests: any[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const payload = await request.json() as any; requests.push(payload);
    const latest = [...payload.messages].reverse().find((message: any) => message.role === "tool" && message.content.includes('"expectedRevision"'));
    // Quant tool text includes its model-facing JSON projection.
    const text = latest?.content ?? "";
    const state = text.includes("\nTask details: ") ? JSON.parse(text.split("\nTask details: ")[1]!) : undefined;
    const action = calls.shift();
    let args: any = { action };
    if (action === "declare") args = { action, expectedRevision: state.expectedRevision,
      requestEntryId: state.latestRequest.entryId, task: { id: "native-study", goal: "AAPL research",
        scope: { symbols: ["AAPL"], market: "US", start: "2026-01-01", end: "2026-02-09" },
        constraints: { allowedTools: ["run_backtest"], notes: [] }, dataRefs: [], reportRequired: false,
        criteria: [{ id: "return", description: "Total return", tool: "run_backtest", parameters: { symbol: "AAPL" }, metrics: ["Total return"] }] } };
    if (action === "cancel") args = { action, expectedRevision: state.expectedRevision, reason: "User cancelled" };
    const tool = action === "community_probe" ? "community_probe" : "research_task";
    if (tool === "community_probe") args = {};
    const delta = action ? { role: "assistant", tool_calls: [{ index: 0, id: `call-${requests.length}`, type: "function", function: { name: tool, arguments: JSON.stringify(args) } }] }
      : { role: "assistant", content: "Fixture finished" };
    const base = { id: "fixture", object: "chat.completion.chunk", created: 0, model: "fixture" };
    return new Response([{ ...base, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: action ? "tool_calls" : "stop" }] }]
      .map(value => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: `${server.url}v1`,
    api: "openai-completions", apiKey: "fixture", models: [{ id: "fixture", contextWindow: 100000, maxTokens: 4096 }] } } }));
  const run = async (prompt: string) => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../index.ts"), "pi", "--offline", "--no-extensions",
      "--no-skills", "--no-context-files", "--extension", community, "--model", "fixture/fixture", "--thinking", "off",
      "--session", sessionFile, "--mode", "json", prompt], { cwd: root,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, OHQUANT_DIR: join(root, "quant"), PI_OFFLINE: "1", PI_TELEMETRY: "0", NO_PROXY: "127.0.0.1,localhost" },
      stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), 45_000);
    try {
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect({ code, err }).toEqual({ code: 0, err: "" });
      expect(out).toContain("Fixture finished");
      return out;
    } finally { clearTimeout(timer); child.kill(); }
  };
  try {
    const output = await run("Research AAPL from 2026-01-01 to 2026-02-09; then cancel on my request.");
    expect(calls).toEqual([]);
    expect(output).not.toContain('"executed":true');
    expect(output).toContain("cancelled");
    expect(JSON.stringify(requests[0])).toContain("Research task workflow:");
    expect(requests[0].tools.some((tool: any) => tool.function.name === "run_backtest")).toBe(true);
    const entries = readFileSync(sessionFile, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const state = projectResearchState(entries, ["research_task", "run_backtest", "community_probe"]);
    expect(state.task?.status).toBe("cancelled");
    expect(state.taskErrors).toEqual([]);
    expect(entries.filter(entry => entry.message?.role === "toolResult" && entry.message?.toolName === "community_probe")
      .every(entry => entry.message.isError)).toBe(true);
    calls.push("read");
    const resumed = await run("Read the current task.");
    expect(resumed).toContain(state.task!.revision);
    expect(resumed).toContain('cancelled');
  } finally {
    server.stop(true);
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected fixture directory");
    rmSync(root, { recursive: true, force: true });
  }
}, 100_000);
