import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "../src/buffer.ts";
import { PanelController } from "../src/panel.ts";
import { savePanelPortfolio } from "../../storage/panel-portfolio.ts";
import { loadSettings, saveSettings } from "../../storage/index.ts";

const OHQ = join(process.cwd(), ".ohquant-test-panel-ctrl");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
  savePanelPortfolio({ updated: "", symbols: [], groups: [] });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

function key(name: string, char = "") {
  return { name, sequence: char, shift: false, ctrl: false, meta: false };
}

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

describe("PanelController portfolio UI", () => {
  it("lets config switch the current portfolio file used by the portfolio panel", () => {
    const portfolioDir = join(OHQ, "portfolio");
    mkdirSync(portfolioDir, { recursive: true });
    writeFileSync(join(portfolioDir, "holdings.json"), JSON.stringify({
      name: "当前主组合",
      updated: "2026-06-01T00:00:00+08:00",
      funds: [{ code: "161725", name: "招商中证白酒" }, { code: "_CASH_", name: "现金" }],
      focusSectors: ["消费"],
    }, null, 2));
    writeFileSync(join(portfolioDir, "holdings_v2_semicon.json"), JSON.stringify({
      name: "聚焦半导体",
      updated: "2026-05-31T00:00:00+08:00",
      funds: [{ code: "008888", name: "半导体芯片ETF联接C" }],
      focusSectors: ["半导体"],
    }, null, 2));

    const configPanel = new PanelController();
    configPanel.open("config");
    const configBuf = new Buffer(120, 28);
    configPanel.render(configBuf);
    expect(configBuf.toPlain().join("\n")).toContain("Active portfolio: 当前主组合");
    expect(configBuf.toPlain().join("\n")).toContain("Portfolio");
    expect(configBuf.toPlain().join("\n")).toContain("Source");
    expect(configBuf.toPlain().join("\n")).toContain("Token");
    expect(configBuf.toPlain().join("\n")).toContain("Local settings panel.");
    expect(configBuf.toPlain().join("\n")).not.toContain("-- Basic --");
    expect(configBuf.toPlain().join("\n")).toContain("↑↓ move  ↵ toggle/edit  esc close");
    expect(configBuf.toPlain().join("\n")).not.toContain("Use slash commands for data");
    expect(configBuf.toPlain().join("\n")).toContain("当前主组合 · holdi");
    configPanel.handleKey("", key("down"));
    configPanel.handleKey("", key("down"));
    configPanel.handleKey("", key("return"));
    configPanel.close();

    const settings = loadSettings();
    expect(settings.preferences.currentPortfolioFile).toBe("holdings_v2_semicon.json");

    const portfolioPanel = new PanelController();
    portfolioPanel.open("portfolio");
    const buf = new Buffer(120, 28);
    portfolioPanel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Selected: 当前主组合");
    expect(plain).toContain("聚焦半导体");
    expect(plain).toContain("当前主组合");
  });

  it("renders local portfolio comparison rows in the portfolio panel", () => {
    const panel = new PanelController();
    const portfolioDir = join(OHQ, "portfolio");
    mkdirSync(portfolioDir, { recursive: true });
    writeFileSync(join(portfolioDir, "holdings.json"), JSON.stringify({
      name: "当前主组合",
      updated: "2026-06-01T00:00:00+08:00",
      funds: [{ code: "161725", name: "招商中证白酒" }, { code: "_CASH_", name: "现金" }],
      focusSectors: ["消费"],
    }, null, 2));
    writeFileSync(join(portfolioDir, "holdings_v2_kc50.json"), JSON.stringify({
      name: "科创50宽基",
      updated: "2026-05-30T00:00:00+08:00",
      funds: [{ code: "011613", name: "华夏科创50ETF联接C" }, { code: "_CASH_", name: "现金" }],
      focusSectors: ["科创50", "AI"],
    }, null, 2));
    writeFileSync(join(portfolioDir, "holdings_v2_semicon.json"), JSON.stringify({
      name: "聚焦半导体",
      updated: "2026-05-31T00:00:00+08:00",
      funds: [{ code: "008888", name: "半导体芯片ETF联接C" }],
      focusSectors: ["半导体"],
    }, null, 2));
    const settings = loadSettings();
    settings.preferences.currentPortfolioFile = "holdings_v2_semicon.json";
    saveSettings(settings);

    panel.open("portfolio");
    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Local portfolios");
    expect(plain).toContain("Selected: 当前主组合");
    expect(plain).toContain("聚焦半导体");
    expect(plain).toContain("当前主组合");

    panel.close();
  });

  it("lets config save a source-specific key", () => {
    const panel = new PanelController();
    panel.open("config");
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    for (const ch of "test-llmquant-key") {
      panel.handleKey(ch, key("", ch));
    }
    panel.handleKey("", key("return"));
    panel.close();

    const settings = loadSettings();
    expect(settings.env.LLMQUANT_API_KEY).toBe("test-llmquant-key");
  });

  it("lets config cycle through data sources", () => {
    const panel = new PanelController();
    panel.open("config");
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    panel.close();

    const settings = loadSettings();
    expect(settings.preferences.source).toBe("financial-datasets");
  });

  it("renders a dedicated resume selector and returns a resume command", () => {
    const cwdDir = join(OHQ, "sessions", encodeCwd(process.cwd()));
    const otherDir = join(OHQ, "sessions", encodeCwd("C:\\tmp\\other-project"));
    mkdirSync(cwdDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });

    const activeId = "019eaf98-85f6-7ddc-96c1-1a32a2389963";
    const otherId = "019eaf98-85f6-7ddc-96c1-1a32a2389977";
    writeFileSync(
      join(cwdDir, `2026-06-13T08-00-00-000Z_${activeId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: activeId, timestamp: "2026-06-13T08:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m1", timestamp: "2026-06-13T08:03:00.000Z", message: { role: "user", content: "请你参考 https://github.com/earendil-works/pi 这个进行一次修改" } }),
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(otherDir, `2026-06-10T08-00-00-000Z_${otherId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: otherId, timestamp: "2026-06-10T08:00:00.000Z", cwd: "C:\\tmp\\other-project" }),
        JSON.stringify({ type: "message", id: "m2", timestamp: "2026-06-10T08:05:00.000Z", message: { role: "user", content: "Install gstack: run git clone --single-branch" } }),
      ].join("\n"),
      "utf-8",
    );

    const panel = new PanelController();
    panel.open("resume");
    panel.setCurrentSessionMeta({
      id: activeId,
      createdAt: "2026-06-13T08:00:00.000Z",
      usage: { tokens: 100, contextWindow: 1000, percent: 10 },
      entryCount: { messages: 1, compactions: 0, branches: 0 },
    });
    expect((panel as any)["mode"]).toBe("resume");

    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Resume a previous session");
    expect(plain).toContain("↑↓ move  ↵ resume  esc close");
    expect(plain).toContain("U: 请你参考");

    const result = panel.handleKey("", key("return"));
    expect(result?.command).toContain("/resume ");
    expect(result?.close).toBe(true);
    panel.close();
  });

  it("resumes the arrow-key selected JSONL session instead of the first item", () => {
    const cwdDir = join(OHQ, "sessions", encodeCwd(process.cwd()));
    mkdirSync(cwdDir, { recursive: true });

    const firstId = "019eaf98-85f6-7ddc-96c1-1a32a2381111";
    const secondId = "019eaf98-85f6-7ddc-96c1-1a32a2382222";
    writeFileSync(
      join(cwdDir, `2026-06-13T08-00-00-000Z_${firstId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: firstId, timestamp: "2026-06-13T08:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m1", timestamp: "2026-06-13T08:03:00.000Z", message: { role: "user", content: "第一个会话" } }),
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(cwdDir, `2026-06-12T08-00-00-000Z_${secondId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: secondId, timestamp: "2026-06-12T08:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m2", timestamp: "2026-06-12T08:05:00.000Z", message: { role: "user", content: "第二个会话" } }),
      ].join("\n"),
      "utf-8",
    );

    const panel = new PanelController();
    panel.open("resume");
    panel.handleKey("", key("down"));

    const result = panel.handleKey("", key("return"));
    expect(result).toEqual({ command: `/resume ${secondId}`, close: true });
    panel.close();
  });

  it("marks legacy markdown session history as unsupported in resume panel", () => {
    const legacyDir = join(OHQ, "sessions", "2026-06-10");
    const cwdDir = join(OHQ, "sessions", encodeCwd(process.cwd()));
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(cwdDir, { recursive: true });

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
    const activeId = "019eaf98-85f6-7ddc-96c1-1a32a2389963";
    writeFileSync(
      join(cwdDir, `2026-06-13T08-00-00-000Z_${activeId}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id: activeId, timestamp: "2026-06-13T08:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m1", timestamp: "2026-06-13T08:03:00.000Z", message: { role: "user", content: "新的 JSONL 会话" } }),
      ].join("\n"),
      "utf-8",
    );
    const future = new Date("2026-06-14T00:00:00.000Z");
    utimesSync(legacyPath, future, future);

    const panel = new PanelController();
    panel.open("resume");
    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("[legacy]");
    expect(plain).toContain("Legacy transcript");
    expect(plain).toContain("U: 股票代码");
    expect(plain).toContain("A: 数据拉取遇到点问题");

    const result = panel.handleKey("", key("return"));
    expect(result?.command).toBeUndefined();
    const after = new Buffer(120, 28);
    panel.render(after);
    expect(after.toPlain().join("\n")).toContain("Unsupported legacy session archive");
    panel.close();
  });

  it("uses the same panel frame size for config, resume, and portfolio", () => {
    const configPanel = new PanelController();
    configPanel.open("config");
    const resumePanel = new PanelController();
    resumePanel.open("resume");
    const portfolioPanel = new PanelController();
    portfolioPanel.open("portfolio");

    const configBuf = new Buffer(120, 28);
    const resumeBuf = new Buffer(120, 28);
    const portfolioBuf = new Buffer(120, 28);
    configPanel.render(configBuf);
    resumePanel.render(resumeBuf);
    portfolioPanel.render(portfolioBuf);

    const configLines = configBuf.toPlain();
    const resumeLines = resumeBuf.toPlain();
    const portfolioLines = portfolioBuf.toPlain();
    const configTop = configLines.find((line) => line.includes("Config"));
    const resumeTop = resumeLines.find((line) => line.includes("Resume a previous session"));
    const portfolioTop = portfolioLines.find((line) => line.includes("Local portfolios"));
    expect(configTop).toBeDefined();
    expect(resumeTop).toBeDefined();
    expect(portfolioTop).toBeDefined();
    expect(configTop!.indexOf("╭")).toBe(resumeTop!.indexOf("╭"));
    expect(configTop!.lastIndexOf("╮")).toBe(resumeTop!.lastIndexOf("╮"));
    expect(configTop!.indexOf("╭")).toBe(portfolioTop!.indexOf("╭"));
    expect(configTop!.lastIndexOf("╮")).toBe(portfolioTop!.lastIndexOf("╮"));
  });
});
