import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
    expect(configBuf.toPlain().join("\n")).toContain("Set active portfolio");
    expect(configBuf.toPlain().join("\n")).toContain("A Source");
    expect(configBuf.toPlain().join("\n")).toContain("A Key");
    expect(configBuf.toPlain().join("\n")).toContain("US/HK Source");
    expect(configBuf.toPlain().join("\n")).toContain("US/HK Key");
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
    panel.handleKey("", key("return"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    for (const ch of "test-tushare-token") {
      panel.handleKey(ch, key("", ch));
    }
    panel.handleKey("", key("return"));
    panel.close();

    const settings = loadSettings();
    expect(settings.env.TUSHARE_TOKEN).toBe("test-tushare-token");
  });

  it("lets config distinguish A-share and US/HK sources", () => {
    const panel = new PanelController();
    panel.open("config");
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("down"));
    panel.handleKey("", key("return"));
    panel.close();

    const settings = loadSettings();
    expect(settings.preferences.aShareSource).toBe("tushare");
    expect(settings.preferences.globalSource).toBe("financial-datasets");
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
    expect((panel as any)["mode"]).toBe("resume");

    const buf = new Buffer(120, 28);
    panel.render(buf);
    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Resume a previous session");
    expect(plain).toContain("↑↓ move  ↵ resume  esc close");

    const result = panel.handleKey("", key("return"));
    expect(result?.command).toContain("/resume ");
    expect(result?.close).toBe(true);
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
