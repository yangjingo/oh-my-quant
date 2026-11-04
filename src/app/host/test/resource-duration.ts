import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, platform, arch, release } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// Run the same harness against two clean, pinned checkouts. Receipts contain
// aggregates only; synthetic workspace contents and Host tokens stay local.
const [checkoutArg, receiptArg, intervalArg, durationArg] = process.argv.slice(2);
if (!checkoutArg || !receiptArg) throw new Error("Usage: bun resource-duration.ts CHECKOUT RECEIPT INTERVAL_MS DURATION_MS");
const checkout = resolve(checkoutArg), receipt = resolve(receiptArg);
const interval = Number(intervalArg), duration = Number(durationArg);
if (!Number.isSafeInteger(interval) || interval < 1000 || !Number.isSafeInteger(duration) || duration < interval * 2) {
  throw new Error("Invalid duration or interval");
}
const git = (...args: string[]) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
const revision = git("rev-parse", "HEAD");
if (git("status", "--porcelain", "--untracked-files=no")) throw new Error("Checkout has tracked changes");
if (existsSync(receipt)) throw new Error("Receipt already exists");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const harness = fileURLToPath(import.meta.url);
const harnessHash = sha256(readFileSync(harness));
const lockHash = sha256(readFileSync(join(checkout, "bun.lock")));
const root = mkdtempSync(join(tmpdir(), "whyj-resource-146-"));
const resolvedTemp = realpathSync(tmpdir()), resolvedRoot = realpathSync(root);
if (dirname(resolvedRoot) !== resolvedTemp || !basename(resolvedRoot).startsWith("whyj-resource-146-")) throw new Error("Unexpected synthetic workspace location");
console.log("Synthetic workspace:", resolvedRoot);
// Explicit allowlist prevents provider credentials and proxy settings leaking
// into the synthetic process. This process never reads the user's workspace.
const allowed = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR"]);
for (const key of Object.keys(process.env)) if (!allowed.has(key.toUpperCase())) delete process.env[key];
Object.assign(process.env, { HOME: root, USERPROFILE: root, OHQUANT_DIR: root,
  OHQUANT_SKILLS_DIR: join(root, "skills"), WHYJ_RESOURCE_LEASE_ROOT: join(root, "lease-registry"), NO_PROXY: "127.0.0.1,localhost" });
process.chdir(root);
const load = (path: string) => import(pathToFileURL(join(checkout, path)).href);
// Wrap only the test process's factory export, without holding the returned
// Agent strongly. Weak references observe object retention, not proof of a leak:
// collection timing is controlled by Bun and remains nondeterministic.
const { mock } = await import("bun:test");
const quantUrl = pathToFileURL(join(checkout, "src/runtime/quant-harness.ts")).href;
const quant = await import(quantUrl);
const originalCreate = quant.createQuantResearchAgent;
const weakAgents: WeakRef<object>[] = [];
mock.module(quantUrl, () => ({ ...quant, createQuantResearchAgent: (...args: unknown[]) => {
  const agent = originalCreate(...args); weakAgents.push(new WeakRef(agent)); return agent;
} }));
const [{ DEFAULT_SETTINGS }, { saveSettings }, { createDefaultSessionDependencies }, { createResearchService }, { startWorkbenchServer }] = await Promise.all([
  load("src/types/config.ts"), load("src/storage/index.ts"), load("src/runtime/session-dependencies.ts"),
  load("src/app/services/research.ts"), load("src/app/workbench/server.ts"),
]);
const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const payload = await request.json() as { model: string };
  const chunk = { id: "fixture", object: "chat.completion.chunk", created: 0, model: payload.model };
  const frame = (delta: object, finish_reason: string | null) => "data: " + JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason }] }) + "\n\n";
  return new Response(frame({ role: "assistant", content: "Synthetic resource measurement." }, null) + frame({}, "stop") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
} });
const settings = structuredClone(DEFAULT_SETTINGS);
settings.provider = "custom"; settings.model = "resource-fixture"; settings.thinkingLevel = "off";
settings.providers = { custom: { baseUrl: model.url.origin + "/v1", api: "openai-completions", apiKey: "synthetic-only" } };
saveSettings(settings);
mkdirSync(join(root, "assets")); writeFileSync(join(root, "assets", "index.html"), "<html><head></head><body>fixture</body></html>");
let created = 0, cleaned = 0, cleanupFailures = 0, completed = 0, gaps = 0, unsettledSamples = 0;
const service = createResearchService({ cwd: root, overview: { intervalMs: 0, loadPortfolio: () => ({ symbols: [] }), quoteFetcher: async () => [] }, dependencies: () => {
  created++; const deps = createDefaultSessionDependencies({ cwd: root }); const cleanup = deps.env.cleanup.bind(deps.env);
  deps.env.cleanup = async () => { try { await cleanup(); cleaned++; } catch (error) { cleanupFailures++; throw error; } }; return deps;
} });
const host = startWorkbenchServer({ service, port: 0, assetsRoot: join(root, "assets") });
const emit = (record: object) => appendFileSync(receipt, JSON.stringify(record) + "\n", { encoding: "utf8", flag: "a" });
writeFileSync(receipt, JSON.stringify({ type: "start", revision, harnessHash, lockHash, intervalMs: interval, durationMs: duration,
  startedAt: new Date().toISOString(), bun: Bun.version, os: platform(), arch: arch(), osRelease: release(),
  description: "Single process includes Host, deterministic loopback provider, and sampler. Weak references observe Agent objects after requested GC; collection timing is nondeterministic. Dependency cleanup counts are lifecycle proxies." }) + "\n", { flag: "wx" });
const start = performance.now(); let previous = start, wallPrevious = Date.now();
let failed = false, outcome: Record<string, unknown> | undefined;
try {
  await host.ready;
  const origin = host.server.url.origin;
  const bootstrap = await (await fetch(origin + "/api/workbench/bootstrap")).json() as { token: string };
  const headers = { "x-workbench-token": bootstrap.token };
  const status = async () => {
    const response = await fetch(origin + "/api/host/status", { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Host status failed");
    return await response.json() as { observers: number; activeRuns: number; clients: number };
  };
  const files = (dir: string): { count: number; bytes: number } => {
    let count = 0, bytes = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { const nested = files(path); count += nested.count; bytes += nested.bytes; }
      else if (entry.isFile()) { count++; bytes += statSync(path).size; }
    }
    return { count, bytes };
  };
  const retained: string[] = [];
  while (true) {
    const now = performance.now(), wall = Date.now();
    const gapMs = Math.max(now - previous, wall - wallPrevious) - (completed ? interval : 0);
    if (gapMs > Math.max(60000, interval * 0.1)) { gaps++; emit({ type: "gap", at: new Date().toISOString(), excessMs: Math.round(gapMs) }); }
    previous = now; wallPrevious = wall;
    const identity = await service.client.identity();
    const session = await service.client.createSession();
    const snapshot = await service.client.session(session.sessionId);
    await service.client.submit({ workspaceId: identity.workspaceId, sessionId: session.sessionId, requestId: randomUUID(), expectedRevision: snapshot.revision, text: "Respond with a short synthetic answer." });
    const deadline = performance.now() + 30000;
    let finished;
    do { await Bun.sleep(50); finished = await service.client.session(session.sessionId); } while (finished.state === "running" && performance.now() < deadline);
    if (finished.state !== "settled") throw new Error("Synthetic session did not settle");
    retained.push(session.sessionId); completed++;
    // Keep a bounded, equal working set in both revisions.
    if (retained.length > 40) {
      const old = retained.shift()!; const state = await service.client.session(old);
      await service.client.deleteSession({ workspaceId: identity.workspaceId, sessionId: old, expectedRevision: state.revision });
    }
    const streamAbort = new AbortController();
    const response = await fetch(origin + "/api/workbench/events", { headers, signal: AbortSignal.any([streamAbort.signal, AbortSignal.timeout(10000)]) });
    if (!response.ok || !response.body) throw new Error("Host event stream failed");
    const reader = response.body.getReader(); const first = await reader.read();
    if (!new TextDecoder().decode(first.value).includes('"type":"ready"')) throw new Error("Missing event stream handshake");
    streamAbort.abort(); await reader.cancel().catch(() => {});
    let state = await status();
    for (let i = 0; i < 100 && (state.observers || state.activeRuns || cleaned + cleanupFailures < created); i++) { await Bun.sleep(100); state = await status(); }
    const settled = !state.observers && !state.activeRuns && cleaned === created && cleanupFailures === 0 && weakAgents.length === completed;
    if (!settled) unsettledSamples++;
    Bun.gc(true);
    await Bun.sleep(0); Bun.gc(true);
    const weakAgentsAlive = weakAgents.filter(ref => ref.deref()).length;
    const memory = process.memoryUsage();
    emit({ type: "sample", at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start), completed, retained: retained.length,
      agentsCreated: weakAgents.length, weakAgentsAliveAfterGc: weakAgentsAlive,
      rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external,
      dependenciesCreated: created, successfulCleanups: cleaned, failedCleanups: cleanupFailures, outstandingOrFailedDependencyProxy: created - cleaned, settled,
      observers: state.observers, activeRuns: state.activeRuns, clients: state.clients, temporary: files(root) });
    if (performance.now() - start >= duration) break;
    await Bun.sleep(interval);
  }
  const sourceUnchanged = git("rev-parse", "HEAD") === revision && !git("status", "--porcelain", "--untracked-files=no") && sha256(readFileSync(harness)) === harnessHash;
  const minimumSamples = Math.max(2, Math.floor(duration / interval * 0.9));
  outcome = { type: "end", at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start), completed, minimumSamples, gaps, sourceUnchanged, unsettledSamples, failedCleanups: cleanupFailures,
    outcome: gaps || !sourceUnchanged || completed < minimumSamples || unsettledSamples || cleanupFailures ? "incomplete" : "completed" };
} catch (error) {
  failed = true;
  // Error details can contain local paths; retain only the class in receipts.
  emit({ type: "error", at: new Date().toISOString(), errorClass: error instanceof Error ? error.name : "unknown" });
  console.error(error);
} finally {
  try {
    await host.close(); model.stop(true); process.chdir(checkout);
    if (realpathSync(root) !== resolvedRoot || dirname(resolvedRoot) !== resolvedTemp) throw new Error("Synthetic workspace changed before cleanup");
    rmSync(resolvedRoot, { recursive: true });
  } catch (error) {
    failed = true;
    emit({ type: "cleanup-error", at: new Date().toISOString(), errorClass: error instanceof Error ? error.name : "unknown" });
    console.error(error);
  }
}
if (!failed && outcome) emit(outcome);
if (failed) process.exitCode = 1;
