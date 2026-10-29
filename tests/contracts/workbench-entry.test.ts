import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHostClient } from "../../src/app/host/client.ts";
import { createResearchService } from "../../src/app/services/research.ts";
import { startWorkbenchServer } from "../../src/app/workbench/server.ts";
import { saveSettings } from "../../src/storage/index.ts";
import { DEFAULT_SETTINGS } from "../../src/types/config.ts";
import type { WorkbenchClient, WorkbenchEvent } from "../../src/types/workbench.ts";

async function eventually<T>(read: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 500; i++) { const value = await read(); if (matches(value)) return value; await Bun.sleep(10); }
  throw new Error("Contract fixture did not reach the expected state");
}

// The identical scenario is exercised at the service boundary and through the
// actual authenticated Host HTTP/SSE transport. Both use the real agent with an
// isolated local model, never a live provider or an external financial effect.
for (const transport of ["direct", "host"] as const) test(`${transport}: shared run identity, save, follow-up and exact cancellation`, async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-entry-contract-"));
  const previous = Object.fromEntries(["OHQUANT_DIR", "OHQUANT_SKILLS_DIR", "WHYJ_RESOURCE_LEASE_ROOT", "NO_PROXY"].map(key => [key, process.env[key]]));
  Object.assign(process.env, { OHQUANT_DIR: root, OHQUANT_SKILLS_DIR: join(root, "skills"), WHYJ_RESOURCE_LEASE_ROOT: join(root, "leases"), NO_PROXY: "127.0.0.1,localhost" });
  let requestCount = 0, held = false, release: (() => void) | undefined;
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const payload = await request.json() as { model: string; messages: Array<{ role: string; content: unknown }> };
    requestCount++;
    const text = JSON.stringify(payload.messages.findLast(message => message.role === "user")?.content);
    const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: "contract-fixture", object: "chat.completion.chunk", created: 0, model: payload.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    if (text.includes("hold for cancellation")) return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      held = true; controller.enqueue(new TextEncoder().encode(": held\n\n"));
      release = () => { try { controller.enqueue(new TextEncoder().encode(chunk({ role: "assistant", content: "Late fixture response" }) + chunk({}, "stop") + "data: [DONE]\n\n")); controller.close(); } catch { /* The cancelled consumer may already be closed. */ } };
    } }), { headers: { "content-type": "text/event-stream" } });
    return new Response(chunk({ role: "assistant", content: "Controlled contract answer; no live data." }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  let service: ReturnType<typeof createResearchService> | undefined, server: ReturnType<typeof startWorkbenchServer> | undefined, unsubscribe: (() => void) | undefined;
  try {
    const settings = structuredClone(DEFAULT_SETTINGS); settings.provider = "custom"; settings.model = "contract-fixture"; settings.thinkingLevel = "off";
    settings.providers = { custom: { baseUrl: model.url.origin + "/v1", api: "openai-completions", apiKey: "contract-fixture-key" } }; saveSettings(settings);
    const assets = join(root, "assets"); mkdirSync(assets); writeFileSync(join(assets, "index.html"), "<html><head></head><body>fixture</body></html>");
    service = createResearchService({ cwd: root });
    if (transport === "host") server = startWorkbenchServer({ port: 0, assetsRoot: assets, service });
    const client: WorkbenchClient = server ? createHostClient({ baseUrl: server.server.url.origin, retryMs: 20 }) : service.client;
    const events: WorkbenchEvent[] = []; let connected = transport === "direct";
    unsubscribe = client.subscribe(event => { events.push(event); if (event.type === "connection" && event.connected) connected = true; });
    await eventually(async () => connected, Boolean);
    const identity = await client.identity();
    const request = async (text: string) => ({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, requestId: randomUUID(), expectedRevision: (await client.session(identity.sessionId)).revision!, text });
    const first = await client.submit(await request("Controlled first question"));
    const completed = await eventually(() => client.session(identity.sessionId), snapshot => snapshot.state === "settled");
    expect(completed.identity).toEqual({ ...identity, runId: first.runId });
    expect(completed.turns.at(-1)?.text).toContain("Controlled contract answer");
    const artifact = await client.save!({ workspaceId: identity.workspaceId, ...first, expectedRevision: completed.revision!, expectedArtifactRevision: null });
    const reopened = await client.reload!({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, artifactId: artifact.id, sha256: artifact.sha256 });
    expect(reopened.identity.runId).toBe(first.runId); expect(reopened.artifact.sha256).toBe(artifact.sha256);
    const followup = await client.followup!({ ...await request("Controlled follow-up"), previousRunId: first.runId });
    const followed = await eventually(() => client.session(identity.sessionId), snapshot => snapshot.state === "settled" && snapshot.identity.runId === followup.runId);
    expect(followed.turns.some(turn => turn.operation === "followup" && turn.previousRunId === first.runId)).toBe(true);
    const pending = await client.followup!({ ...await request("hold for cancellation"), previousRunId: followup.runId });
    await eventually(async () => held, Boolean);
    await client.cancel({ workspaceId: identity.workspaceId, sessionId: identity.sessionId, runId: pending.runId });
    release?.();
    const stopped = await eventually(() => client.session(identity.sessionId), snapshot => snapshot.state === "cancelled");
    await Bun.sleep(100);
    const after = await client.session(identity.sessionId);
    expect(after.identity.runId).toBe(pending.runId); expect(after.state).toBe("cancelled");
    expect(after.turns.at(-1)?.text).not.toContain("Late fixture response"); expect(requestCount).toBe(3);
    await eventually(async () => events.some(event => event.type === "snapshot" && event.snapshot.state === "cancelled" && event.identity.runId === pending.runId), Boolean);
    expect(stopped.identity.runId).toBe(pending.runId);
  } finally {
    release?.(); unsubscribe?.(); await server?.close(); if (!server) await service?.close(); model.stop(true);
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected contract fixture root");
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
