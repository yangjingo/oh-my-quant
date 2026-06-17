import { describe, expect, it } from "bun:test";
import {
  DATA_SOURCE_PROMPTS,
  formatCompletedToolLine,
  formatToolArgs,
  formatToolLine,
  normalizeDataSourceFlag,
  shellDisplayName,
  toolDisplayLabel,
} from "./catalog.ts";

describe("tool display catalog", () => {
  it("maps local data tools to provider-specific labels", () => {
    expect(toolDisplayLabel("fetch_bars")).toBe("AKShare · Daily Bars");
    expect(toolDisplayLabel("search_symbols")).toBe("Tushare · Search");
    expect(toolDisplayLabel("unknown_tool")).toBe("unknown tool");
  });

  it("formats tool line with args", () => {
    expect(formatToolLine("fetch_bars", "000300.SH")).toBe("AKShare · Daily Bars · 000300.SH");
  });

  it("lists distinct data source prompts for config panel", () => {
    expect(DATA_SOURCE_PROMPTS.map((entry) => entry.label)).toEqual([
      "AKShare bars",
      "Tushare bars",
      "LLMQuant bars",
      "FD bars",
      "JoinQuant bars",
    ]);
    expect(DATA_SOURCE_PROMPTS.every((entry) => entry.prompt.includes("--source"))).toBe(true);
  });

  it("normalizes source flag aliases", () => {
    expect(normalizeDataSourceFlag("llmquant-data")).toBe("llmquant");
    expect(normalizeDataSourceFlag("jointquant")).toBe("joinquant");
    expect(normalizeDataSourceFlag("jqdata")).toBe("joinquant");
  });

  it("formats tool args from common fields", () => {
    expect(formatToolArgs({ symbol: "000300.SH" })).toBe("000300.SH");
    expect(formatToolArgs({ ticker: "AAPL" })).toBe("AAPL");
    expect(formatToolArgs({})).toBeUndefined();
  });

  it("formats bash command args", () => {
    const shell = shellDisplayName();
    expect(formatToolArgs({ command: "bun test src/tools" })).toBe("bun test src/tools");
    expect(toolDisplayLabel("bash")).toBe(shell);
    expect(formatToolLine("bash", "Get-Content src/tools/catalog.ts")).toBe(`${shell}.Read · Get-Content src/tools/catalog.ts`);
    expect(formatToolLine("bash", "Set-Content out.txt value")).toBe(`${shell}.Write · Set-Content out.txt value`);
    expect(formatToolLine("bash", "Get-Content a.ts | Set-Content b.ts")).toBe(`${shell}.Update · Get-Content a.ts | Set-Content b.ts`);
    expect(formatToolLine("bash", "node script.js")).toBe(`${shell}.Shell · node script.js`);
  });

  it("classifies bash read commands", () => {
    const commands = [
      "rg -n \"TODO\" src",
      "git diff -- src/tools/catalog.ts",
      "bun test src/tools/catalog.test.ts",
      "npx tsc --noEmit",
    ];
    const shell = shellDisplayName();
    for (const command of commands) {
      expect(formatToolLine("bash", command)).toBe(`${shell}.Read · ${command}`);
    }
  });

  it("classifies bash write commands", () => {
    const commands = [
      "New-Item out.txt",
      "Set-Content out.txt value",
      "echo value > out.txt",
      "bun add typebox",
    ];
    const shell = shellDisplayName();
    for (const command of commands) {
      expect(formatToolLine("bash", command)).toBe(`${shell}.Write · ${command}`);
    }
  });

  it("classifies bash update commands before write/read fallbacks", () => {
    const commands = [
      "apply_patch",
      "git commit -m test",
      "Remove-Item out.txt",
      "Get-Content a.ts | ForEach-Object { $_ -replace 'a', 'b' } | Set-Content a.ts",
    ];
    const shell = shellDisplayName();
    for (const command of commands) {
      expect(formatToolLine("bash", command)).toBe(`${shell}.Update · ${command}`);
    }
  });

  it("formats completed write tools like an edit summary", () => {
    expect(formatCompletedToolLine(
      "bash",
      "Set-Content src/tools/catalog.ts value",
      "@@ -1,2 +1,2 @@\n-old value\n+new value",
    )).toBe("Edited src/tools/catalog.ts (+1 -1)");
    expect(formatCompletedToolLine(
      "bash",
      "New-Item src/tools/new-file.ts",
      "",
    )).toBe("Added src/tools/new-file.ts");
    expect(formatCompletedToolLine(
      "bash",
      "Get-Content src/tools/catalog.ts",
      "file text",
    )).toBe(`${shellDisplayName()}.Read · Get-Content src/tools/catalog.ts`);
  });

  it("classifies generic bash commands as shell", () => {
    const commands = [
      "node scripts/dev.js",
      "python -c \"print(1)\"",
      "whyj --help",
      "",
    ];
    const shell = shellDisplayName();
    for (const command of commands) {
      const expected = command ? `${shell}.Shell · ${command}` : `${shell}.Shell`;
      expect(formatToolLine("bash", command || undefined)).toBe(expected);
    }
  });

  it("formats quant tools with pi-style namespaces", () => {
    expect(toolDisplayLabel("check_risk")).toBe("Quant.Risk");
    expect(formatToolLine("check_risk", "000300.SH")).toBe("Quant.Risk · 000300.SH");
    expect(formatToolLine("run_backtest", "000300.SH")).toBe("Quant.Backtest · 000300.SH");
    expect(formatToolLine("compute_factor", "momentum")).toBe("Quant.Factor · momentum");
  });
});
