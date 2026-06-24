import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  saveArtifact,
  loadArtifact,
  loadArtifactMeta,
  listArtifacts,
  deleteArtifact,
  artifactPath,
} from "../src/artifacts.ts";

const OHQ = join(process.cwd(), ".ohquant-test-artifacts-storage");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

describe("artifact storage CRUD", () => {
  it("saves and loads an artifact", () => {
    const sessionId = "test-session-001";
    const html = "<!DOCTYPE html><html><body>Test</body></html>";

    saveArtifact(sessionId, html, { title: "Test Artifact", messageCount: 5 });

    const loaded = loadArtifact(sessionId);
    expect(loaded).toBe(html);

    const meta = loadArtifactMeta(sessionId);
    expect(meta).not.toBeNull();
    expect(meta!.sessionId).toBe(sessionId);
    expect(meta!.title).toBe("Test Artifact");
    expect(meta!.messageCount).toBe(5);
    expect(meta!.bytes).toBe(html.length);
  });

  it("returns null for non-existent artifact", () => {
    expect(loadArtifact("nonexistent")).toBeNull();
    expect(loadArtifactMeta("nonexistent")).toBeNull();
  });

  it("lists artifacts sorted by createdAt desc", () => {
    saveArtifact("s1", "<html>A</html>", { title: "First" });
    saveArtifact("s2", "<html>B</html>", { title: "Second" });

    const metas = listArtifacts();
    expect(metas.length).toBe(2);
    // Most recent first
    expect(metas[0]!.createdAt >= metas[1]!.createdAt).toBe(true);
  });

  it("deletes artifact and sidecar", () => {
    const sessionId = "test-delete-001";
    saveArtifact(sessionId, "<html>Delete me</html>");

    expect(loadArtifact(sessionId)).not.toBeNull();
    expect(loadArtifactMeta(sessionId)).not.toBeNull();

    const deleted = deleteArtifact(sessionId);
    expect(deleted).toBe(true);

    expect(loadArtifact(sessionId)).toBeNull();
    expect(loadArtifactMeta(sessionId)).toBeNull();
  });

  it("deleteArtifact returns false for non-existent", () => {
    expect(deleteArtifact("never-saved")).toBe(false);
  });

  it("saveArtifact updates metadata on re-save", () => {
    const sessionId = "test-update-001";
    saveArtifact(sessionId, "<html>V1</html>", { title: "V1", messageCount: 1 });

    const firstMeta = loadArtifactMeta(sessionId);
    expect(firstMeta!.messageCount).toBe(1);

    saveArtifact(sessionId, "<html><body>V2 with more content</body></html>", { title: "V2 Updated", messageCount: 2 });

    const secondMeta = loadArtifactMeta(sessionId);
    expect(secondMeta!.title).toBe("V2 Updated");
    expect(secondMeta!.messageCount).toBe(2);
    expect(secondMeta!.bytes).toBeGreaterThan(firstMeta!.bytes);
  });

  it("artifactPath returns path under artifacts dir", () => {
    const path = artifactPath("my-session");
    expect(path).toContain("artifacts");
    expect(path).toContain("my-session.html");
  });

  it("writes artifact file to disk", () => {
    const sessionId = "test-disk-001";
    const html = "<!DOCTYPE html><html><body>On disk</body></html>";
    saveArtifact(sessionId, html);

    const path = artifactPath(sessionId);
    expect(existsSync(path)).toBe(true);
    const onDisk = readFileSync(path, "utf-8");
    expect(onDisk).toBe(html);
  });

  it("listArtifacts returns empty array when no artifacts exist", () => {
    expect(listArtifacts()).toEqual([]);
  });
});
