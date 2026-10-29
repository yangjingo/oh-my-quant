import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkbenchSessionStore } from "../src/workbench-sessions.ts";
import type { WorkbenchSessionRecord } from "../../types/workbench-session.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "whyj-checkpoint-")); roots.push(root);
  const sessionId = randomUUID(), workspaceId = "test-workspace";
  const record: WorkbenchSessionRecord = { version: 1, workspaceId, sessionId, cwd: root, name: "研究", coreSessionId: null, runCount: 0, updatedAt: new Date().toISOString(),
    snapshot: { identity: { workspaceId, sessionId, runId: null }, revision: 0, state: "idle", turns: [], market: { refreshedAt: "", quotes: [], source: { provider: null, updatedAt: null, available: 0, total: 0 } },
      output: { conclusion: { statement: null, confidence: null, boundary: null, settled: false }, evidence: [], artifacts: [] } } };
  return { root, record, store: createWorkbenchSessionStore(root), file: join(root, sessionId + ".json") };
}
test("checkpoint replacement is revision checked; stale and duplicate creates preserve committed bytes", async () => {
  const { record, store, file } = fixture();
  const first = await store.save(record, null);
  const next = { ...record, name: "改名", snapshot: { ...record.snapshot, revision: 1 } };
  const second = await store.save(next, first), bytes = readFileSync(file);
  await expect(store.save(record, first)).rejects.toMatchObject({ code: "ESTORAGECONFLICT" });
  await expect(store.save(record, null)).rejects.toMatchObject({ code: "ESTORAGECONFLICT" });
  expect(readFileSync(file)).toEqual(bytes);
  expect(store.load(record.workspaceId, record.sessionId)).toMatchObject({ record: next, revision: second });
});
test("metadata listing stays available for other sessions; corrupt and unknown files are never overwritten", async () => {
  const { record, store, file } = fixture(); const revision = await store.save(record, null);
  const original = readFileSync(file, "utf8");
  for (const invalid of [original.replace('"version":1', '"version":99'), original.replace('"name":"研究"', '"name":"伪造"'), "not json"]) {
    writeFileSync(file, invalid);
    expect(() => store.load(record.workspaceId, record.sessionId)).toThrow();
    await expect(store.save(record, revision)).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe(invalid);
    expect(store.list(record.workspaceId)).toHaveLength(1);
  }
  const other = { ...record, sessionId: randomUUID(), snapshot: { ...record.snapshot, identity: { ...record.snapshot.identity, sessionId: "" } } };
  other.snapshot.identity.sessionId = other.sessionId;
  await store.save(other, null);
  expect(store.list(record.workspaceId).filter(item => item.header)).toHaveLength(1);
  expect(store.load(other.workspaceId, other.sessionId).record.name).toBe("研究");
});
test("listing does not load or validate a transcript payload; selected reads validate integrity and workspace", async () => {
  const { record, store, file } = fixture(); await store.save(record, null);
  const firstLine = readFileSync(file, "utf8").split("\n")[0]!;
  writeFileSync(file, firstLine + "\n" + "broken payload".repeat(100000));
  expect(store.list(record.workspaceId)[0]?.header?.sessionId).toBe(record.sessionId);
  expect(() => store.load(record.workspaceId, record.sessionId)).toThrow();
  expect(() => store.load("another-workspace", record.sessionId)).toThrow();
  expect(() => store.load(record.workspaceId, "../settings")).toThrow();
});
