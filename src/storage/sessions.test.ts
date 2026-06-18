import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listStoredSessions } from "./sessions.ts";

const OHQ = join(process.cwd(), ".ohquant-test-sessions-storage");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

describe("session storage summaries", () => {
  it("lists JSONL and legacy Markdown sessions with recent message previews", () => {
    const cwd = process.cwd();
    const jsonlDir = join(OHQ, "sessions", encodeCwd(cwd));
    const legacyDir = join(OHQ, "sessions", "2026-06-10");
    mkdirSync(jsonlDir, { recursive: true });
    mkdirSync(legacyDir, { recursive: true });

    const jsonlId = "019eaf98-85f6-7ddc-96c1-1a32a2389963";
    writeFileSync(
      join(jsonlDir, `2026-06-13T08-00-00-000Z_${jsonlId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: jsonlId, timestamp: "2026-06-13T08:00:00.000Z", cwd }),
        JSON.stringify({ type: "message", id: "m1", timestamp: "2026-06-13T08:01:00.000Z", message: { role: "user", content: [{ type: "text", text: "查看今天行情" }] } }),
        JSON.stringify({ type: "message", id: "m2", timestamp: "2026-06-13T08:02:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "今天行情如下" }] } }),
      ].join("\n"),
      "utf-8",
    );

    const legacyPath = join(legacyDir, "session-031036.md");
    writeFileSync(
      legacyPath,
      [
        "# Session 2026-06-10 031036",
        "",
        "## 03:08:19 · User",
        "股票代码 — 比如 000001.SZ 或 AAPL",
        "",
        "## 03:08:24 · Assistant",
        "数据拉取遇到点问题，加日期参数再试。",
      ].join("\n"),
      "utf-8",
    );
    const newer = new Date("2026-06-14T00:00:00.000Z");
    utimesSync(legacyPath, newer, newer);

    const sessions = listStoredSessions({ cwd, scope: "cwd", sort: "updated", limit: 10 });

    expect(sessions.map((session) => session.format)).toEqual(["markdown", "jsonl"]);
    expect(sessions[0]).toMatchObject({
      format: "markdown",
      id: "session-031036",
      preview: expect.stringContaining("股票代码"),
      messageCount: 2,
    });
    expect(sessions[0]?.recentMessages).toEqual([
      { role: "user", text: "股票代码 — 比如 000001.SZ 或 AAPL" },
      { role: "assistant", text: "数据拉取遇到点问题，加日期参数再试。" },
    ]);
    expect(sessions[1]).toMatchObject({
      format: "jsonl",
      id: jsonlId,
      preview: "查看今天行情",
      messageCount: 2,
    });
    expect(sessions[1]?.recentMessages).toEqual([
      { role: "user", text: "查看今天行情" },
      { role: "assistant", text: "今天行情如下" },
    ]);
  });
});
