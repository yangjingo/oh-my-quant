import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listLocalPortfolios } from "../src/local-portfolios.ts";
import { loadSettings, saveSettings } from "../src/settings.ts";

const OHQ = join(process.cwd(), ".ohquant-test-local-portfolios");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(join(OHQ, "portfolio"), { recursive: true });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

function writePortfolio(fileName: string, body: unknown): void {
  writeFileSync(join(OHQ, "portfolio", fileName), JSON.stringify(body, null, 2), "utf-8");
}

describe("local portfolio discovery", () => {
  it("dedupes identical portfolios and prefers the configured active file", () => {
    const portfolio = {
      name: "精英4组合（精简自13只·WhyJ Quant优化）",
      updated: "2026-06-17T00:00:00+08:00",
      focusSectors: ["AI应用/芯片", "通信/光模块"],
      funds: [
        { code: "022364", name: "永赢科技智选发起A" },
        { code: "016372", name: "信澳匠心严选一年持有A" },
      ],
    };
    writePortfolio("holdings_copy_long_name.json", portfolio);
    writePortfolio("holdings_primary.json", portfolio);
    const settings = loadSettings();
    settings.preferences.currentPortfolioFile = "holdings_primary.json";
    saveSettings(settings);

    const portfolios = listLocalPortfolios();

    expect(portfolios).toHaveLength(1);
    expect(portfolios[0]?.fileName).toBe("holdings_primary.json");
    expect(portfolios[0]?.name).toBe("精英4组合（精简自13只·WhyJ Quant优化）");
  });

  it("uses a stable representative when no duplicate is the configured active file", () => {
    const portfolio = {
      name: "同内容组合",
      updated: "2026-06-17T00:00:00+08:00",
      funds: [{ code: "022364", name: "永赢科技智选发起A" }],
    };
    writePortfolio("holdings_longer_name.json", portfolio);
    writePortfolio("holdings_short.json", portfolio);

    const portfolios = listLocalPortfolios();

    expect(portfolios).toHaveLength(1);
    expect(portfolios[0]?.fileName).toBe("holdings_short.json");
  });

  it("keeps same-name portfolios when holdings differ", () => {
    writePortfolio("holdings_one.json", {
      name: "同名组合",
      updated: "2026-06-17T00:00:00+08:00",
      funds: [{ code: "022364", name: "永赢科技智选发起A" }],
    });
    writePortfolio("holdings_two.json", {
      name: "同名组合",
      updated: "2026-06-17T00:00:00+08:00",
      funds: [{ code: "016372", name: "信澳匠心严选一年持有A" }],
    });

    const portfolios = listLocalPortfolios();

    expect(portfolios.map((portfolio) => portfolio.fileName).sort()).toEqual([
      "holdings_one.json",
      "holdings_two.json",
    ]);
  });

  it("derives condensed themes from fund names and industry fields", () => {
    writePortfolio("holdings_dynamic.json", {
      name: "聚焦半导体组合",
      updated: "2026-06-17T00:00:00+08:00",
      funds: [
        { code: "001", name: "某某半导体芯片ETF联接", industry: "集成电路" },
        { code: "002", name: "某某通信光模块主题", sector: "光通信" },
        { code: "003", name: "某某人工智能产业", theme: "算力" },
      ],
    });

    const portfolio = listLocalPortfolios()[0];

    expect(portfolio?.focusSectors).toEqual(expect.arrayContaining(["半导体", "通信/光模块", "AI"]));
    expect(portfolio?.focusSectors[0]).toBe("半导体");
    expect(portfolio?.strategy).toContain("半导体");
    expect(portfolio?.strategy).toContain("通信/光模块");
    expect(portfolio?.riskTag).toBe("适度分散");
  });
});
