import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { artifactPath, artifactReference, listArtifactVersions, loadArtifact, loadArtifactMeta, materializeArtifact, saveArtifact } from "../src/artifacts.ts";

let root: string;
let previous: string | undefined;
beforeEach(() => {
  previous = process.env.OHQUANT_DIR;
  root = mkdtempSync(join(tmpdir(), "ohq-report-versions-"));
  process.env.OHQUANT_DIR = root;
});
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected report test directory");
  rmSync(root, { recursive: true, force: true });
});

it("preserves old HTML and metadata while repairing views from the chosen revision", () => {
  const first = saveArtifact("research", "<html>原版</html>", { title: "Original", messageCount: 2 });
  const second = saveArtifact("research", "<html>new version</html>", { title: "New", messageCount: 4 });
  expect(loadArtifact(artifactReference(first))).toBe("<html>原版</html>");
  expect(loadArtifactMeta(artifactReference(first))?.title).toBe("Original");
  expect(loadArtifact("research")).toBe("<html>new version</html>");
  expect(listArtifactVersions("research").map(meta => meta.revision)).toEqual([second.revision!, first.revision!]);
  writeFileSync(artifactPath(artifactReference(first)), "corrupted HTML view");
  const repaired = materializeArtifact(artifactReference(first));
  expect(readFileSync(repaired, "utf8")).toBe("<html>原版</html>");
  expect(loadArtifactMeta("research")?.revision).toBe(second.revision);
});

it("rejects traversal and a damaged head without falling back to legacy files", () => {
  const first = saveArtifact("research", "<html>original</html>");
  const dir = join(root, "artifacts");
  writeFileSync(join(dir, "research.html"), "unsafe legacy fallback");
  writeFileSync(join(dir, "research.meta.json"), JSON.stringify(first));
  writeFileSync(join(dir, "research.report.json"), "{");
  expect(loadArtifact("research")).toBeNull();
  expect(loadArtifact(artifactReference(first))).toBe("<html>original</html>");
  expect(() => saveArtifact("research", "replacement")).toThrow("damaged");
  for (const bad of ["../settings", "x@../settings", "x@" + "a".repeat(63), "C:/outside", "CON"]) {
    expect(() => artifactPath(bad)).toThrow("Invalid report reference");
  }
});

it("archives the previous legacy report when a new version is generated", () => {
  saveArtifact("bootstrap", "bootstrap");
  const dir = join(root, "artifacts");
  writeFileSync(join(dir, "legacy.html"), "<html>legacy output</html>");
  writeFileSync(join(dir, "legacy.meta.json"), JSON.stringify({ sessionId: "legacy", createdAt: "2026-01-01T00:00:00Z", title: "Legacy", messageCount: 1, bytes: 25 }));
  saveArtifact("legacy", "<html>new output</html>");
  const versions = listArtifactVersions("legacy");
  expect(versions).toHaveLength(2);
  expect(loadArtifact(artifactReference(versions[1]!))).toBe("<html>legacy output</html>");
});

it("compares the expected report head inside the write lock and preserves conflicts and corruption", () => {
  const first = saveArtifact("research", "original", {}, null);
  const second = saveArtifact("research", "new version", {}, first.revision!);
  const head = join(root, "artifacts", "research.report.json"), bytes = readFileSync(head);
  for (const stale of [null, first.revision!]) {
    expect(() => saveArtifact("research", "stale overwrite", {}, stale)).toThrow("Report changed");
    expect(readFileSync(head)).toEqual(bytes);
  }
  expect(listArtifactVersions("research").map(meta => meta.revision)).toEqual([second.revision!, first.revision!]);
  writeFileSync(head, "damaged report");
  expect(() => saveArtifact("research", "repair without consent", {}, second.revision!)).toThrow("damaged");
  expect(readFileSync(head, "utf8")).toBe("damaged report");
  expect(loadArtifact(artifactReference(first))).toBe("original");
});

it("keeps all committed revisions from eight independent writers", async () => {
  const children = Array.from({ length: 8 }, (_, index) => Bun.spawn([
    process.execPath, join(import.meta.dir, "fixtures", "report-writer.ts"), String(index),
  ], { env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe" }));
  try {
    const results = await Promise.all(children.map(async child => ({ code: await child.exited, stderr: await new Response(child.stderr).text() })));
    expect(results).toEqual(Array.from({ length: 8 }, () => ({ code: 0, stderr: "" })));
    const versions = listArtifactVersions("parallel");
    expect(versions.map(meta => meta.title).sort()).toEqual(Array.from({ length: 8 }, (_, i) => `Writer ${i}`));
    for (const meta of versions) expect(loadArtifact(artifactReference(meta))).toBe(`<html>${meta.title}</html>`);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    await Promise.all(children.map(child => child.exited));
  }
}, 15_000);

it("keeps the previous committed head after a process dies between archive and head writes", async () => {
  const first = saveArtifact("parallel", "<html>before crash</html>");
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "report-writer.ts"), "crash"], {
    env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe",
  });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(join(root, "checkpoint")) && Date.now() < deadline && child.exitCode === null) await Bun.sleep(20);
    expect(existsSync(join(root, "checkpoint"))).toBe(true);
    child.kill(9);
    await child.exited;
    expect(loadArtifactMeta("parallel")?.revision).toBe(first.revision);
    expect(listArtifactVersions("parallel")).toHaveLength(1);
    const expired = new Date(Date.now() - 20_000);
    // The owner is confirmed dead before simulating lease expiry.
    utimesSync(join(root, "artifacts", "parallel.report.json.lock"), expired, expired);
    saveArtifact("parallel", "<html>recovered</html>");
    expect(listArtifactVersions("parallel")).toHaveLength(2);
    expect(loadArtifact(artifactReference(first))).toBe("<html>before crash</html>");
  } finally {
    if (child.exitCode === null) child.kill();
    await child.exited;
  }
}, 10_000);
