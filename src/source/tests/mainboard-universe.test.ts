import { expect, it } from "bun:test";
import { fetchMainboardUniverse, normalizeMainboardMembers } from "../src/mainboard-universe.ts";

const sh = [{ "证券代码": "600000", "证券简称": "浦发银行" }];
const sz = [{ "板块": "主板", "A股代码": "000001", "A股简称": "平安银行" },
  { "板块": "创业板", "A股代码": "300001", "A股简称": "Not main board" }];

it("normalizes both public rosters, deduplicates and excludes the growth board", async () => {
  const calls: string[] = [];
  const result = await fetchMainboardUniverse({ execute: async (script, args, options) => {
    expect(script).toContain('symbol="主板A股"');
    expect(script).toContain('symbol="A股列表"');
    expect(script).toContain("force_ascii=True");
    expect(options?.signal).toBeDefined();
    calls.push(args![0]!);
    return { stdout: JSON.stringify(args![0] === "SH" ? [...sh, ...sh] : sz), stderr: "" };
  } });
  expect(calls.sort()).toEqual(["SH", "SZ"]);
  expect(result.members.map(member => member.symbol)).toEqual(["000001.SZ", "600000.SH"]);
  expect(result.sources.map(source => source.count)).toEqual([1, 1]);
  expect(result.sources.every(source => Number.isFinite(Date.parse(source.observedAt)))).toBe(true);
});

it("fails closed on empty, malformed, wrong-board and conflicting identities", () => {
  for (const value of [[], null, [{ "证券代码": "688001", "证券简称": "STAR" }],
    [{ "证券代码": 600000, "证券简称": "numeric" }], [...sh, { ...sh[0], "证券简称": "conflict" }]])
    expect(() => normalizeMainboardMembers(value, "SH")).toThrow();
  expect(() => normalizeMainboardMembers([{ ...sz[0], "板块": "unknown" }], "SZ")).toThrow();
  expect(() => normalizeMainboardMembers([sz[1]], "SZ")).toThrow();
});

it("rejects one-exchange failure and cancels the sibling bridge", async () => {
  let sibling: AbortSignal | undefined;
  await expect(fetchMainboardUniverse({ execute: async (_script, args, options) => {
    sibling = options?.signal;
    if (args![0] === "SZ") throw new Error("SZ unavailable");
    return { stdout: JSON.stringify(sh), stderr: "" };
  } })).rejects.toThrow("SZ unavailable");
  expect(sibling?.aborted).toBe(true);
});

it("propagates caller cancellation without returning a single-exchange universe", async () => {
  const controller = new AbortController();
  await expect(fetchMainboardUniverse({ signal: controller.signal, execute: async () => {
    controller.abort(new Error("cancel roster"));
    return { stdout: JSON.stringify(sh), stderr: "" };
  } })).rejects.toThrow("cancel roster");
});
