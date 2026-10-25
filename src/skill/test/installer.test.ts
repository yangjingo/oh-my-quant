import { expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { installSkillRepository, type SkillFetch } from "../installer.ts";
import { RECEIPT } from "../archive.ts";
import { FIRST, NEXT, archiveEntries, skillArchive } from "./fixtures/archive.ts";

async function fixture(run: (f: { root: string; target: string; state: { revision: string; archive: Buffer; status: string }; calls: string[]; request: SkillFetch; install: () => ReturnType<typeof installSkillRepository> }) => void | Promise<void>) {
  const base = mkdtempSync(join(tmpdir(), "whyj-skill-http-")), root = join(base, "skills"), target = join(root, "owner-repo");
  const state = { revision: FIRST, archive: skillArchive(), status: "ahead" }, calls: string[] = [];
  const request: SkillFetch = async url => {
    calls.push(url);
    if (url.includes("/commits/")) return Response.json({ sha: state.revision });
    if (url.includes("/compare/")) return Response.json({ status: state.status });
    if (url.includes("/tarball/")) return new Response(state.archive);
    throw new Error("Unexpected request");
  };
  try { await run({ root, target, state, calls, request, install: () => installSkillRepository(root, "owner/repo", request) }); }
  finally {
    const within = relative(realpathSync(tmpdir()), realpathSync(base));
    if (!within.startsWith("whyj-skill-http-") || within.includes(sep)) throw new Error("Unsafe fixture cleanup");
    rmSync(base, { recursive: true, force: true });
  }
}

it("installs the exact immutable archive without Git/curl and records file hashes", () => fixture(async f => {
  const previous = process.env.PATH;
  try {
    process.env.PATH = "";
    const result = await f.install();
    expect(result).toMatchObject({ success: true, revision: FIRST, source: "https://github.com/owner/repo.git" });
    expect(f.calls.at(-1)).toEndWith(`/tarball/${FIRST}`);
    expect(readFileSync(join(f.target, "中文.txt"), "utf8")).toBe("资源");
    const receipt = JSON.parse(readFileSync(join(f.target, RECEIPT), "utf8"));
    expect(receipt).toMatchObject({ version: 1, repo: "owner/repo", revision: FIRST });
    expect(receipt.files["SKILL.md"]).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(join(f.target, ".git"))).toBe(false);
    expect(readdirSync(f.root)).toEqual(["owner-repo"]);
  } finally { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; }
}));

it("reuses a validated pin offline and fast-forwards by replacing the complete tree", () => fixture(async f => {
  const pin = { revision: FIRST, requiredFiles: ["SKILL.md"] };
  expect((await installSkillRepository(f.root, "owner/repo", f.request, undefined, pin)).success).toBe(true);
  expect(f.calls).toHaveLength(1);
  expect((await installSkillRepository(f.root, "owner/repo", async () => { throw new Error("offline"); }, undefined, pin)).success).toBe(true);
  f.state.revision = NEXT; f.state.archive = skillArchive({ "SKILL.md": "updated", "new.md": "new" });
  expect((await f.install()).revision).toBe(NEXT);
  expect(readFileSync(join(f.target, "SKILL.md"), "utf8")).toBe("updated");
  expect(existsSync(join(f.target, "中文.txt"))).toBe(false);
  expect(f.calls.some(url => url.includes(`/compare/${FIRST}...${NEXT}`))).toBe(true);
  expect(readdirSync(f.root)).toEqual(["owner-repo"]);
}));

it.each(["behind", "diverged", "unknown"])("rejects %s history without changing the installed revision", status => fixture(async f => {
  await f.install(); f.calls.length = 0; f.state.revision = NEXT; f.state.status = status;
  const result = await f.install();
  expect(result.success).toBe(false); expect(result.message).toContain("not a fast-forward");
  expect(f.calls.some(url => url.includes("tarball"))).toBe(false);
  expect(JSON.parse(readFileSync(join(f.target, RECEIPT), "utf8")).revision).toBe(FIRST);
}));

it.each(["changed", "deleted", "untracked", "ignored"])("protects %s local files before any HTTP request", kind => fixture(async f => {
  await f.install(); f.calls.length = 0;
  if (kind === "deleted") rmSync(join(f.target, "SKILL.md"));
  else writeFileSync(join(f.target, kind === "changed" ? "SKILL.md" : kind === "ignored" ? ".local-note" : "note.txt"), "keep");
  const result = await f.install();
  expect(result.success).toBe(false); expect(result.message).toContain("Local changes"); expect(f.calls).toEqual([]);
}));

it("rechecks edits made during the download and preserves a concurrently created destination", () => fixture(async f => {
  await f.install(); f.state.revision = NEXT;
  const result = await installSkillRepository(f.root, "owner/repo", async (url, init) => {
    if (url.includes("tarball")) writeFileSync(join(f.target, "SKILL.md"), "concurrent edit");
    return f.request(url, init);
  });
  expect(result.success).toBe(false);
  expect(readFileSync(join(f.target, "SKILL.md"), "utf8")).toBe("concurrent edit");
  const other = await installSkillRepository(f.root, "another/repo", async (url, init) => {
    if (url.includes("tarball")) { mkdirSync(join(f.root, "another-repo")); writeFileSync(join(f.root, "another-repo", "note"), "keep"); }
    return f.request(url, init);
  });
  expect(other.success).toBe(false); expect(other.message).toContain("Another installation");
  expect(readFileSync(join(f.root, "another-repo", "note"), "utf8")).toBe("keep");
}));

it("preserves legacy Git/manual folders without network access or discarding history", () => fixture(async f => {
  mkdirSync(join(f.target, ".git"), { recursive: true }); writeFileSync(join(f.target, ".git", "HEAD"), "local history");
  writeFileSync(join(f.target, "SKILL.md"), "local skill");
  const result = await f.install();
  expect(result.success).toBe(false); expect(result.message).toContain("Move the folder outside");
  expect(readFileSync(join(f.target, ".git", "HEAD"), "utf8")).toBe("local history"); expect(f.calls).toEqual([]);
}));

it("rejects malformed receipts, a different repository and symlink destinations", () => fixture(async f => {
  await f.install(); const receipt = join(f.target, RECEIPT), original = readFileSync(receipt, "utf8");
  writeFileSync(receipt, "broken"); expect((await f.install()).success).toBe(false);
  writeFileSync(receipt, original.replace('"owner/repo"', '"other/repo"')); expect((await f.install()).success).toBe(false);
  const link = join(f.root, "linked-repo"); symlinkSync(f.target, link, process.platform === "win32" ? "junction" : "dir");
  expect((await installSkillRepository(f.root, "linked/repo", f.request)).success).toBe(false);
  expect(readFileSync(join(f.target, "SKILL.md"), "utf8")).toBe("original\n");
}));

it("rejects overlapping installs, cleans cancelled staging and permits retry", () => fixture(async f => {
  const controller = new AbortController(); let release!: () => void, entered!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const pending = installSkillRepository(f.root, "owner/repo", async (url, init) => {
    if (url.includes("tarball")) { entered(); await pause; }
    return f.request(url, init);
  }, controller.signal);
  await started;
  expect((await f.install()).message).toContain("already running");
  controller.abort(); release();
  expect((await pending).success).toBe(false); expect(existsSync(f.target)).toBe(false); expect(readdirSync(f.root)).toEqual([]);
  expect((await f.install()).success).toBe(true);
}));

it("does not alter the previous tree on failed/corrupt downloads or a missing required entry", () => fixture(async f => {
  await f.install(); f.state.revision = NEXT;
  for (const body of [Buffer.from("broken gzip"), skillArchive({ "README.md": "no skill" })]) {
    f.state.archive = body;
    const result = await installSkillRepository(f.root, "owner/repo", f.request, undefined, { revision: NEXT, requiredFiles: ["SKILL.md"] });
    expect(result.success).toBe(false);
    expect(readFileSync(join(f.target, "SKILL.md"), "utf8")).toBe("original\n");
    expect(readdirSync(f.root)).toEqual(["owner-repo"]);
  }
}));

it.each(["../outside", "/absolute", "C:/outside", "root/../../outside", "root/file:stream", "root/CON.txt", "root/.git/config", "root/.whyj-skill.json"])("rejects unsafe archive path %s", path => fixture(async f => {
  f.state.archive = archiveEntries([{ path, content: "escape" }]);
  expect((await f.install()).success).toBe(false);
  expect(existsSync(f.target)).toBe(false); expect(readdirSync(f.root)).toEqual([]);
}));

it.each(["SymbolicLink", "Link"] as const)("rejects archive %s entries before publication", type => fixture(async f => {
  f.state.archive = archiveEntries([{ path: "root/SKILL.md", content: "valid" }, { path: "root/link", type, linkpath: "../../outside" }]);
  expect((await f.install()).success).toBe(false); expect(existsSync(f.target)).toBe(false);
}));

it("omits internal example symlinks but requires real selected skill entries", () => fixture(async f => {
  f.state.archive = archiveEntries([
    { path: "root/skills/SKILL.md", content: "skill" },
    { path: "root/examples/dashboard/.claude/skills", type: "SymbolicLink", linkpath: "../../../skills" },
  ]);
  const pin = { revision: FIRST, requiredFiles: ["skills/SKILL.md"] };
  expect((await installSkillRepository(f.root, "owner/repo", f.request, undefined, pin)).success).toBe(true);
  expect(existsSync(join(f.target, "examples/dashboard/.claude/skills"))).toBe(false);
  const linked = { revision: FIRST, requiredFiles: ["examples/dashboard/.claude/skills/SKILL.md"] };
  expect((await installSkillRepository(f.root, "other/repo", f.request, undefined, linked)).success).toBe(false);
  expect(existsSync(join(f.root, "other-repo"))).toBe(false);
}));

it("rejects case-colliding paths and archives with multiple repository roots", () => fixture(async f => {
  for (const paths of [["root/SKILL.md", "root/skill.md"], ["first/SKILL.md", "second/README.md"]]) {
    f.state.archive = archiveEntries(paths.map(path => ({ path, content: "data" })));
    expect((await f.install()).success).toBe(false); expect(readdirSync(f.root)).toEqual([]);
  }
}));

it.each(["../repo", "owner/..", "owner/repo/extra", "--owner/repo", "owner/repo;echo"])("rejects invalid repository %s before IO", async repo => {
  expect((await installSkillRepository("unused", repo, async () => { throw new Error("Must not fetch"); })).message).toContain("owner/repo format");
});

it("rejects mutable pins and escaping required entries before IO", async () => {
  for (const pin of [{ revision: "main", requiredFiles: ["SKILL.md"] }, { revision: FIRST, requiredFiles: ["skills/../../private"] }]) {
    expect((await installSkillRepository("unused", "owner/repo", async () => { throw new Error("Must not fetch"); }, undefined, pin)).message).toContain("Invalid pinned");
  }
});
