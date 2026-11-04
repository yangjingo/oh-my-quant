import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DEFAULT_SETTINGS } from "../../src/types/config.ts";
import { saveSettings } from "../../src/storage/index.ts";
import { createWorkbenchService } from "../../src/app/workbench/service.ts";
import { createFixtureLifetime } from "../../src/app/services/test/fixture-lifetime.ts";
import type { WorkbenchClient, WorkspaceSummary } from "../../src/types/workbench.ts";
// Web and Host have separate TypeScript environments; execute the real store without importing DOM types into the Host build.
const storeModule = "../../apps/web/src/state/workbench-store";
const { createWorkbenchStore } = await import(storeModule) as { createWorkbenchStore(client: WorkbenchClient): { connect(): () => void; submit(text: string): Promise<boolean>; getSnapshot(): { phase: string; sessions: readonly WorkspaceSummary[] } } };

const fixtureLifetime = createFixtureLifetime();
let phase = "setup", modelRequests = 0;
afterEach(() => fixtureLifetime.drain(() => console.error("WHYJ_WORKBENCH_SUMMARY_PENDING " + JSON.stringify({ phase, modelRequests }))), 30000);

test("actual Host/core auto-naming reaches the visible session list without reloading", fixtureLifetime.track(async () => {
  phase = "setup"; modelRequests = 0;
  const root = mkdtempSync(join(tmpdir(), "whyj-summary-"));
  const previous = process.env.OHQUANT_DIR, proxy = process.env.NO_PROXY;
  let provider: ReturnType<typeof Bun.serve> | undefined;
  let service: ReturnType<typeof createWorkbenchService> | undefined, release: (() => void) | undefined;
  try {
    process.env.OHQUANT_DIR = root; process.env.NO_PROXY = "127.0.0.1,localhost";
    phase = "provider-start";
    provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      modelRequests++;
      const payload = await request.json() as { model: string };
      const chunk = (content: string, finish_reason: string | null) => "data: " + JSON.stringify({ id: "summary-fixture", object: "chat.completion.chunk", created: 0, model: payload.model, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason }] }) + "\n\n";
      return new Response(chunk("Hypothetical fixture reply.", null) + chunk("", "stop") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    } });
    phase = "settings";
    const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "summary-fixture"; settings.thinkingLevel = "off";
    settings.providers = { custom: { api: "openai-completions", baseUrl: provider.url.origin + "/v1", apiKey: "summary-fixture-dummy" } }; saveSettings(settings);
    phase = "service-and-connect"; service = createWorkbenchService({ cwd: root });
    const store = createWorkbenchStore(service.client); release = store.connect();
    phase = "wait-ready";
    for (let i = 0; store.getSnapshot().phase !== "ready" && i < 100; i++) await Bun.sleep(10);
    const text = "Compare supplied hypothetical scenarios";
    phase = "submit";
    expect(await store.submit(text)).toBe(true);
    phase = "workspaces";
    const expected = (await service.client.workspaces())[0]!;
    phase = "assert-summary";
    expect(expected.name).toBe(text.slice(0, 32)); expect(expected.runCount).toBe(1);
    expect(store.getSnapshot().sessions.find(row => row.sessionId === expected.sessionId)).toMatchObject({ name: expected.name, runCount: 1 });
    expect(store.getSnapshot().sessions.filter(row => row.name.includes("Compare supplied"))).toHaveLength(1);
  } finally {
    phase = "cleanup";
    try { release?.(); }
    finally {
      try { await service?.close(); }
      finally {
        try { await provider?.stop(true); }
        finally {
          if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
          if (proxy === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = proxy;
          if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected fixture root");
          rmSync(root, { recursive: true, force: true });
        }
      }
    }
  }
}));
