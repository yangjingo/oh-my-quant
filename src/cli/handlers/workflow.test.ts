import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { compareHandler } from "./workflow.ts";
import { savePanelPortfolio } from "../../storage/panel-portfolio.ts";

const OHQ = join(process.cwd(), ".ohquant-test-compare");

beforeEach(() => {
  process.env.OHQUANT_DIR = OHQ;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
  mkdirSync(OHQ, { recursive: true });
});

afterEach(() => {
  delete process.env.OHQUANT_DIR;
  if (existsSync(OHQ)) rmSync(OHQ, { recursive: true, force: true });
});

describe("compareHandler", () => {
  it("rejects when no rule specified", async () => {
    savePanelPortfolio({ updated: "", symbols: [{ code: "000001", name: "Test", added: "2024-01-01" }], groups: [] });
    const result = await compareHandler({}, ["run"]);
    expect(result.success).toBe(false);
    expect(result.message).toContain("--rule");
  });

  it("rejects when portfolio is empty", async () => {
    savePanelPortfolio({ updated: "", symbols: [], groups: [] });
    const result = await compareHandler({ rule: "volatility", threshold: "0.25" }, ["run"]);
    expect(result.success).toBe(false);
    expect(result.message).toContain("No symbols");
  });

  it("rejects volatility rule without threshold", async () => {
    savePanelPortfolio({ updated: "", symbols: [{ code: "000001", name: "Test", added: "2024-01-01" }], groups: [] });
    const result = await compareHandler({ rule: "volatility" }, ["run"]);
    expect(result.success).toBe(false);
    expect(result.message).toContain("--threshold");
  });

  it("rejects drawdown rule without threshold", async () => {
    savePanelPortfolio({ updated: "", symbols: [{ code: "000001", name: "Test", added: "2024-01-01" }], groups: [] });
    const result = await compareHandler({ rule: "drawdown" }, ["run"]);
    expect(result.success).toBe(false);
    expect(result.message).toContain("--threshold");
  });

  it("rejects sector rule without name", async () => {
    savePanelPortfolio({ updated: "", symbols: [{ code: "000001", name: "Test", added: "2024-01-01" }], groups: [] });
    const result = await compareHandler({ rule: "sector" }, ["run"]);
    expect(result.success).toBe(false);
    expect(result.message).toContain("--name");
  });

  it("rejects unknown rule type", async () => {
    savePanelPortfolio({ updated: "", symbols: [{ code: "000001", name: "Test", added: "2024-01-01" }], groups: [] });
    const result = await compareHandler({ rule: "unknown", threshold: "0.25" }, ["run"]);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown rule type");
  });

  it("rejects invalid action", async () => {
    const result = await compareHandler({}, ["invalid"]);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Usage");
  });
});
