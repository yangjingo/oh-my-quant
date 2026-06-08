import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { loadWatchlistEntries } from "../src/watchlist.ts";

const ROOT = join(tmpdir(), "whyj-tui-watchlist-test");
const OHQ = join(ROOT, ".ohquant");

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value), "utf-8");
}

describe("loadWatchlistEntries", () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
    process.env.OHQUANT_DIR = OHQ;
  });

  afterEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
    delete process.env.OHQUANT_DIR;
  });

  it("loads funds and legacy stocks", async () => {
    writeJson(join(OHQ, "watchlist.json"), { funds: [{ code: "510300.SH", name: "沪深300ETF" }] });
    expect(await loadWatchlistEntries()).toEqual([{ code: "510300.SH", name: "沪深300ETF" }]);

    writeJson(join(OHQ, "watchlist.json"), { stocks: [{ code: "000001.SZ", name: "平安银行" }] });
    expect(await loadWatchlistEntries()).toEqual([{ code: "000001.SZ", name: "平安银行" }]);
  });

  it("returns empty list for missing or invalid files", async () => {
    expect(await loadWatchlistEntries()).toEqual([]);
    mkdirSync(OHQ, { recursive: true });
    writeFileSync(join(OHQ, "watchlist.json"), "{bad", "utf-8");
    expect(await loadWatchlistEntries()).toEqual([]);
  });
});
