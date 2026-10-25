import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComposerReferences } from "../workspace/composer-references.ts";
import { activeReferenceQuery, referenceTokens } from "../workspace/reference-syntax.ts";
import { resolveSessionsDir } from "../../storage/index.ts";

let root: string, oldRoot: string | undefined;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "whyj-references-")); oldRoot = process.env.OHQUANT_DIR; process.env.OHQUANT_DIR = join(root, "state"); });
afterEach(() => { if (oldRoot === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = oldRoot; rmSync(root, { recursive: true, force: true }); });
const context = (prompt: string) => JSON.parse(prompt.slice(prompt.indexOf("\n[")));

function savedSession() {
  const dir = join(resolveSessionsDir(), `--${root.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "research.jsonl"), timestamp = "2026-10-25T00:00:00Z";
  const entries = [
    { type: "session", version: 3, id: "research", timestamp, cwd: root },
    { type: "message", id: "question", parentId: null, timestamp, message: { role: "user", content: [{ type: "text", text: "分析科技基金" }] } },
    { type: "message", id: "call", parentId: "question", timestamp, message: { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "research_fund", arguments: { symbol: "022364.OF" } }] } },
    { type: "message", id: "result", parentId: "call", timestamp, message: { role: "toolResult", toolCallId: "tool-1", toolName: "research_fund", isError: false, content: [{ type: "text", text: "Observed NAV 1.25 on 2026-10-23" }] } },
    { type: "message", id: "answer", parentId: "result", timestamp, message: { role: "assistant", content: [{ type: "text", text: "样例历史结论" }] } },
    { type: "message", id: "abandoned", parentId: "answer", timestamp, message: { role: "toolResult", toolCallId: "old", toolName: "shell", content: [{ type: "text", text: "not active" }] } },
    { type: "leaf", id: "selection", parentId: "abandoned", targetId: "answer", timestamp },
  ];
  writeFileSync(path, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
  return path;
}

it("parses quoted Windows paths, deduplicates references and leaves emails, slash commands and escaped @ literal", () => {
  expect(referenceTokens('比较 @README.md @README.md @"file:C:\\My Notes\\中文.md"')).toEqual(["README.md", "file:C:\\My Notes\\中文.md"]);
  expect(referenceTokens("a@host.com \\@literal")).toEqual([]);
  expect(referenceTokens("/config @file:test")).toEqual([]);
  expect(() => referenceTokens('@"file:missing quote')).toThrow("引号");
  expect(activeReferenceQuery('看看 @"file:My Notes/a')).toMatchObject({ query: "file:My Notes/a" });
  expect(activeReferenceQuery('看看 @"file:My Notes/a" ')).toBeNull();
});

it("completes directories and quoted files, then reads an exact text snapshot with provenance", async () => {
  mkdirSync(join(root, "My Notes"));
  writeFileSync(join(root, "My Notes", "中文.md"), "## Evidence\n样例数据");
  const service = new ComposerReferences(root);
  const directory = (await service.suggest("分析 @My"))[0]!;
  expect(directory.fill).toBe('分析 @"file:My Notes/');
  const file = (await service.suggest(directory.fill))[0]!;
  expect(file.fill).toBe('分析 @"file:My Notes/中文.md" ');
  const prompt = await service.expand(file.fill);
  expect(prompt).toStartWith(file.fill);
  expect(context(prompt)[0]).toMatchObject({ kind: "file", content: "## Evidence\n样例数据" });
  expect(context(prompt)[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  writeFileSync(join(root, "My Notes", "中文.md"), "changed later");
  expect(context(prompt)[0].content).toBe("## Evidence\n样例数据");
});

it("rejects missing, binary, oversized and invalid UTF-8 files and respects cancellation", async () => {
  const service = new ComposerReferences(root);
  writeFileSync(join(root, "binary"), Buffer.from([0, 1, 2]));
  writeFileSync(join(root, "invalid"), Buffer.from([0xff]));
  writeFileSync(join(root, "large"), "x".repeat(128 * 1024 + 1));
  for (const name of ["missing", "binary", "invalid", "large", "."]) await expect(service.expand(`@file:${name}`)).rejects.toThrow();
  await expect(service.expand("@file:binary", AbortSignal.abort())).rejects.toThrow();
  await expect(service.expand(Array.from({ length: 9 }, (_, i) => `@file:${i}`).join(" "))).rejects.toThrow("8");
});

it("lists sessions and their evidence, reads only the active branch and never changes the source session", async () => {
  const path = savedSession(), original = readFileSync(path, "utf8"), service = new ComposerReferences(root);
  expect(await service.suggest("比较 @session:科技")).toMatchObject([{ kind: "session", fill: "比较 @session:research " }]);
  expect(await service.suggest("比较 @evidence:research")).toMatchObject([{ kind: "evidence", fill: "比较 @evidence:research/" }]);
  const suggestions = await service.suggest("比较 @evidence:research/");
  expect(suggestions).toHaveLength(1);
  expect(suggestions[0]!.fill).toBe("比较 @evidence:research/result ");
  const prompt = await service.expand("比较 @session:research @evidence:research/result");
  const [session, evidence] = context(prompt);
  expect(session).toMatchObject({ kind: "session", sessionId: "research", leafId: "answer", omittedMessages: 0 });
  expect(JSON.stringify(session)).toContain("样例历史结论");
  expect(evidence).toMatchObject({ kind: "evidence", sessionId: "research", entryId: "result", callEntryId: "call", status: "recorded; not reverified for this request" });
  expect(evidence.result.content[0].text).toContain("Observed NAV");
  await expect(service.expand("@evidence:research/abandoned")).rejects.toThrow("活动分支");
  await expect(service.expand("@session:missing")).rejects.toThrow("会话不存在");
  expect(readFileSync(path, "utf8")).toBe(original);
});
