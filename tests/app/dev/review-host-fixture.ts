// Explicit CI fixture: actual Host/Pi/core/calculator, isolated storage, local dummy provider.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DEFAULT_SETTINGS } from "../../../src/types/config.ts";
import { saveSettings } from "../../../src/storage/index.ts";
import { createDefaultSessionDependencies } from "../../../src/runtime/session-dependencies.ts";
import { createWorkbenchService } from "../../../src/app/workbench/service.ts";
import { startWorkbenchServer } from "../../../src/app/workbench/server.ts";

const root = mkdtempSync(join(tmpdir(), "whyj-review-host-"));
process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
let stage = "idle", advance: (() => void) | undefined, requests = 0, fail = false, legacy = false, sequence = 0, marketRound = 0;
const legacyAnswer = "以下为合成展示，不是投资结论。\n\n\n观察摘要\n────────────────────────\n假设 A    2026-10-23    0.00 CNY    —\n假设 B    2026-10-22    80.00 USD   跨窗口，不能直接比较\n\n\n复核边界\n────────────────────────\n原始数据尚未独立复核，不代表实际行情。";
const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/state") return Response.json({ stage, requests, canAdvance: !!advance });
  if (url.pathname === "/market" && request.method === "POST") { marketRound++; return Response.json({ marketRound }); }
  if (url.pathname === "/advance" && request.method === "POST") { const next = advance; advance = undefined; next?.(); return Response.json({ stage, requests }); }
  const payload = await request.json() as { model: string; messages: { role: string; content: unknown }[] }; requests++;
  const index = payload.messages.findLastIndex(message => message.role === "user");
  const returning = payload.messages.slice(index + 1).some(message => message.role === "tool");
  if (!returning) { fail = JSON.stringify(payload.messages[index]?.content).includes("FAIL"); legacy = JSON.stringify(payload.messages[index]?.content).includes("LEGACY"); }
  const callId = "review-call-" + (++sequence), encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval>;
  const chunk = (delta: unknown, finish_reason: string | null = null) => encoder.encode("data: " + JSON.stringify({ id: "controlled-review", object: "chat.completion.chunk", created: 0, model: payload.model, choices: [{ index: 0, delta, finish_reason }] }) + "\n\n");
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    const send = (delta: unknown) => controller.enqueue(chunk(delta));
    const end = (reason: string) => { clearInterval(heartbeat); controller.enqueue(chunk({}, reason)); controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); };
    heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(": fixture keepalive\n\n")); } catch { clearInterval(heartbeat); } }, 5000);
    if (returning) {
      stage = "answering"; send({ role: "assistant", content: fail ? "受控验收：工具失败已保留。" : legacy ? legacyAnswer : "受控验收：计算工具已返回假设结果，非投资结论。\n\n| 对象 | 观察日期 | 观察值 | 币种 | 缺失字段 | 比较限制 |\n| --- | --- | --- | --- | --- | --- |\n| A | 2026-10-23 | 0.00 | CNY | — | 同一窗口 |\n| B | 2026-10-22 | 80.00 | USD | — | 跨窗口，不直接比较 |" });
      advance = () => { stage = "idle"; end("stop"); }; return;
    }
    stage = "waiting";
    advance = () => { stage = "thinking"; send({ role: "assistant", reasoning_content: "受控验收：核对用户给定的假设输入。" });
      advance = () => { stage = "preparing"; send({ tool_calls: [{ index: 0, id: callId, type: "function", function: { name: "calculate_position_scenarios", arguments: "{" } }] });
        advance = () => { stage = "dispatching"; const args = JSON.stringify({ shares: 100, costPerShare: 10, observedClose: 12, observationDate: "2026-10-23", currency: "CNY", changes: [-0.1, 0, 0.1] });
          send({ tool_calls: [{ index: 0, function: { arguments: args.slice(1) } }] }); end("tool_calls"); };
      };
    };
  }, cancel() { clearInterval(heartbeat); if (callId === "review-call-" + sequence) { stage = "idle"; advance = undefined; } } }), { headers: { "Content-Type": "text/event-stream" } });
} });
const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "review-fixture"; settings.thinkingLevel = "off";
settings.providers = { custom: { api: "openai-completions", baseUrl: provider.url.origin + "/v1", apiKey: "review-fixture-dummy-not-a-secret" } }; saveSettings(settings);
const service = createWorkbenchService({ cwd: root, overview: {
  intervalMs: 0, loadPortfolio: () => ({ symbols: [] }), quoteFetcher: async entries => {
    const round = marketRound;
    if (round) await Bun.sleep(1500);
    return entries.map((entry, index) => ({ ...entry, price: round === 1 && index === 0 ? NaN : 100 + index, pct: index % 2 ? -1 : 1,
      observation: { symbol: entry.code, source: "akshare", sourceLabel: "Synthetic review fixture", asOfDate: "2026-10-23", asOfTime: "15:00:03", basis: "snapshot", fetchedAt: "2026-10-24T00:00:00Z", state: "available", fallback: false } }));
  },
}, dependencies: () => {
  const deps = createDefaultSessionDependencies({ cwd: root });
  return { ...deps, tools: deps.tools.map(tool => tool.name !== "calculate_position_scenarios" ? tool : { ...tool, async execute(...args: Parameters<typeof tool.execute>) {
    stage = "executing"; const signal = args[2];
    await new Promise<void>((done, reject) => {
      const cancel = () => { stage = "idle"; advance = undefined; reject(new Error("Controlled tool stopped")); };
      advance = () => { signal?.removeEventListener("abort", cancel); done(); };
      signal?.addEventListener("abort", cancel, { once: true }); if (signal?.aborted) cancel();
    });
    if (fail) throw new Error("Controlled tool failure");
    return tool.execute(...args);
  } }) };
} });
const host = startWorkbenchServer({ port: 0, service });
console.log(JSON.stringify({ origin: host.server.url.origin, control: provider.url.origin, fixture: "isolated controlled provider, not live model acceptance" }));
const stop = () => { void host.close().finally(() => {
  provider.stop(true);
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected fixture directory");
  rmSync(root, { recursive: true, force: true }); process.exit(0);
}); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
