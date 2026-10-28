import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkbenchService } from "../../src/app/workbench/service.ts";
import { startWorkbenchServer } from "../../src/app/workbench/server.ts";
import { DEFAULT_SETTINGS } from "../../src/types/config.ts";
import { saveSettings } from "../../src/storage/index.ts";



test("actual Host RPC and SSE publish workspace quotes without starting research", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-market-transport-")), previous = process.env.OHQUANT_DIR, proxy = process.env.NO_PROXY;
  process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
  const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "fixture";
  settings.providers = { custom: { api: "openai-completions", baseUrl: "http://127.0.0.1:9/v1", apiKey: "unused-test-value" } }; saveSettings(settings);
  const assets = join(root, "assets"); mkdirSync(assets); writeFileSync(join(assets, "index.html"), "<!doctype html><html></html>");
  const service = createWorkbenchService({ cwd: root, overview: { intervalMs: 0, loadPortfolio: () => ({ symbols: [] }), quoteFetcher: async entries => {
    await Bun.sleep(20); return entries.map(entry => ({ ...entry, price: 100, pct: 1,
      observation: { symbol: entry.code, source: "akshare", sourceLabel: "AKShare", asOfDate: "2026-10-23", fetchedAt: "2026-10-24T00:00:00Z", state: "available", fallback: false } }));
  } } });
  const host = startWorkbenchServer({ port: 0, assetsRoot: assets, service });
  const origin = host.server.url.origin;
  const bootstrap = await (await fetch(origin + "/api/workbench/bootstrap")).json() as { token: string };
  const headers = { "x-workbench-token": bootstrap.token, "Content-Type": "application/json" };
  const rpc = async <T = unknown>(method: string, args: unknown[] = []): Promise<T> => ((await (await fetch(origin + "/api/workbench/rpc", { method: "POST", headers, body: JSON.stringify({ method, args }) })).json()) as { result: T }).result;
  const response = await fetch(origin + "/api/workbench/events", { headers, signal: AbortSignal.timeout(2000) });
  const reader = response.body!.getReader();
  try {
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await rpc("market");
    let text = "";
    while (!text.includes('"status":"success"')) { const chunk = await reader.read(); if (chunk.done) throw new Error("Stream ended"); text += new TextDecoder().decode(chunk.value); }
    expect(text).toContain('"type":"market"'); expect(text).toContain('"asOfDate":"2026-10-23"');
    const market = await rpc<{ quotes: unknown[] }>("market"); expect(market.quotes).toHaveLength(5);
    const identity = await rpc<{ sessionId: string }>("identity"); expect((await rpc<{ state: string }>("session", [identity.sessionId])).state).toBe("idle");
    expect((await rpc<{ runCount: number }[]>("workspaces")).every(session => session.runCount === 0)).toBe(true);
    await rpc("refreshMarket", [false]);
  } finally {
    await reader.cancel(); await host.close();    if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
    if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
    rmSync(root, { recursive: true, force: true });
  }
});
