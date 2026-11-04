import { beforeEach, afterEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { lockSync } from "proper-lockfile";
import { createHash } from "node:crypto";
import { archiveFundNav, loadFundNavDataset } from "../index.ts";
import { subscribeFileEvents } from "../src/fs-events.ts";
import { fundNav, NAV_OBSERVED_AT } from "./fixtures/fund-nav.ts";
import type { FundNavDatasetRef, FundNavSnapshot } from "../../types/fund-data.ts";

let root: string, previous: string | undefined;
beforeEach(() => { previous = process.env.OHQUANT_DIR; root = mkdtempSync(join(tmpdir(), "ohq-public-nav-")); process.env.OHQUANT_DIR = root; });
afterEach(() => {
  if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid NAV fixture directory");
  rmSync(root, { recursive: true, force: true });
});
function path(ref: FundNavDatasetRef): string { return join(root, "data", "akshare", ref.symbol, "nav-revisions", `${ref.revision}.json`); }
function refFromRevision(): FundNavDatasetRef {
  const revisions = join(root, "data", "akshare", "270042.OF", "nav-revisions");
  const files = readdirSync(revisions).filter(file => file.endsWith(".json"));
  expect(files).toHaveLength(1);
  const snapshot = JSON.parse(readFileSync(join(revisions, files[0]!), "utf8")) as FundNavSnapshot;
  return { version: 1, kind: "fund-nav", symbol: snapshot.symbol, market: "A", source: "akshare",
    endpoint: snapshot.endpoint, revision: snapshot.revision,
    contentHash: createHash("sha256").update(JSON.stringify(snapshot.nav)).digest("hex"),
    dates: snapshot.nav.map(row => row.navDate), requested: { start: null, end: null }, snapshotAt: snapshot.fetchedAt,
    adjustment: "unit-nav-unadjusted", availability: "observed-at-fetch" };
}

it("does not replay a NAV revision left by a process that died before the archive call returned", async () => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "fund-nav-crash-after-revision.ts")],
    { env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe" });
  const code = await child.exited, stderr = await new Response(child.stderr).text();
  expect(code).toBe(73); expect(stderr).toBe("");
  expect(() => loadFundNavDataset(refFromRevision())).toThrow(/uncommitted/i);
}, 20_000);

it("keeps a committed NAV revision readable after process death following the marker write", async () => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "fund-nav-crash-after-marker.ts")],
    { env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe" });
  const code = await child.exited, stderr = await new Response(child.stderr).text();
  expect(code).toBe(74); expect(stderr).toBe("");
  const ref = refFromRevision();
  const recovered = loadFundNavDataset(ref).nav;
  expect(recovered.map(row => [row.navDate, row.unitNav])).toEqual(fundNav().map(row => [row.navDate, row.unitNav]));
  expect(recovered.every(row => row.source === "akshare")).toBe(true);
}, 20_000);

it("removes an uncommitted revision when cancellation lands after its immutable file write", async () => {
  const controller = new AbortController();
  const unsubscribe = subscribeFileEvents(event => {
    if (event.detail === "immutable public NAV revision") controller.abort(new Error("cancel before NAV commit"));
  });
  try {
    await expect(archiveFundNav("270042", fundNav(), "fund_open_fund_info_em", NAV_OBSERVED_AT, null, controller.signal)).rejects.toThrow();
  } finally { unsubscribe(); }
  const revisions = join(root, "data", "akshare", "270042.OF", "nav-revisions");
  expect(readdirSync(revisions).filter(file => file.endsWith(".json") || file.endsWith(".commit"))).toEqual([]);
});

it("fails closed on a damaged NAV commit marker without rewriting the revision", async () => {
  const ref = (await archiveFundNav("270042", fundNav(), "fund_open_fund_info_em", NAV_OBSERVED_AT))!;
  const original = readFileSync(path(ref), "utf8");
  writeFileSync(path(ref).replace(/\.json$/u, ".commit"), "{}");
  expect(() => loadFundNavDataset(ref)).toThrow(/damaged commit marker/);
  await expect(archiveFundNav("270042", fundNav(), "fund_open_fund_info_em", NAV_OBSERVED_AT)).rejects.toThrow(/damaged commit marker/);
  expect(readFileSync(path(ref), "utf8")).toBe(original);
});

it("archives canonical public NAV and fee evidence without storing amounts or arbitrary fields", async () => {
  const rows = fundNav().map(row => ({ ...row, privateCash: 87654321, secret: "PRIVATE_NAV" }));
  const ref = (await archiveFundNav("270042", rows, "fund_open_fund_info_em", NAV_OBSERVED_AT, { source: "fund_purchase_em", fetchedAt: NAV_OBSERVED_AT, rate: 0.0003 }))!;
  expect(ref.symbol).toBe("270042.OF");
  expect(ref.kind).toBe("fund-nav");
  const first = loadFundNavDataset(ref), original = readFileSync(path(ref), "utf8");
  expect(first.nav.map(row => row.unitNav)).toEqual([1, 0.5, 0.75]);
  expect(first.fee!.rate).toBe(0.0003);
  expect(original).not.toMatch(/PRIVATE_NAV|87654321|privateCash|secret/);
  const next = (await archiveFundNav("270042.OF", rows.map(row => ({ ...row, unitNav: row.unitNav + 10 })), "fund_open_fund_info_em", NAV_OBSERVED_AT))!;
  expect(next.revision).not.toBe(ref.revision);
  expect(loadFundNavDataset(ref)).toEqual(first);
  expect(readFileSync(path(ref), "utf8")).toBe(original);
  expect(existsSync(join(root, "portfolio"))).toBe(false);
});

it("rejects changed reference metadata and damaged or removed revisions without a current-data fallback", async () => {
  const ref = (await archiveFundNav("270042", fundNav(), "fund_open_fund_info_em", NAV_OBSERVED_AT))!;
  for (const change of [{ revision: "../secret" }, { symbol: "270042.SH" }, { source: "private" }, { snapshotAt: "2026-02-31T00:00:00Z" }, { dates: [...ref.dates].reverse() }, { endpoint: "fund_purchase_em" }, { requested: { start: "2026-02-01", end: null } }]) {
    expect(() => loadFundNavDataset({ ...ref, ...change } as FundNavDatasetRef)).toThrow();
  }
  const original = readFileSync(path(ref), "utf8");
  const changed = JSON.parse(original);
  changed.nav[0].unitNav = 999;
  writeFileSync(path(ref), JSON.stringify(changed));
  expect(() => loadFundNavDataset(ref)).toThrow("does not match");
  await expect(archiveFundNav("270042", fundNav(), "fund_open_fund_info_em", NAV_OBSERVED_AT)).rejects.toThrow();
  expect(readFileSync(path(ref), "utf8")).toBe(JSON.stringify(changed));
  rmSync(path(ref));
  expect(() => loadFundNavDataset(ref)).toThrow("unavailable");
});

it("does not archive empty or invalid observations, and later same-date observations win", async () => {
  expect(await archiveFundNav("270042", [], "fund_open_fund_info_em", NAV_OBSERVED_AT)).toBeNull();
  expect(await archiveFundNav("270042", fundNav().map(row => ({ ...row, fundCode: "000001" })), "fund_open_fund_info_em", NAV_OBSERVED_AT)).toBeNull();
  expect(await archiveFundNav("270042", fundNav().map(row => ({ ...row, navDate: "2026-02-31" })), "fund_open_fund_info_em", NAV_OBSERVED_AT)).toBeNull();
  expect(readdirSync(root)).toEqual([]);
  const ref = (await archiveFundNav("270042", [...fundNav(), { ...fundNav()[0]!, unitNav: 2 }], "fund_open_fund_info_em", NAV_OBSERVED_AT))!;
  expect(loadFundNavDataset(ref).nav.map(row => row.unitNav)).toEqual([2, 0.5, 0.75]);
});

it("commits one immutable snapshot across eight processes and supports cancelled lock waits", async () => {
  const children = Array.from({ length: 8 }, () => Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "fund-nav-writer.ts")], { env: { ...process.env, OHQUANT_DIR: root }, stdout: "pipe", stderr: "pipe" }));
  const runs = await Promise.all(children.map(async child => ({ code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() })));
  expect(runs.every(run => run.code === 0 && !run.err)).toBe(true);
  expect(new Set(runs.map(run => run.out.trim())).size).toBe(1);
  const ref = (await archiveFundNav("270042", fundNav(), "fund_open_fund_info_em", NAV_OBSERVED_AT))!;
  expect(readdirSync(join(root, "data", "akshare", ref.symbol, "nav-revisions")).sort()).toEqual([`${ref.revision}.commit`, `${ref.revision}.json`]);
  const before = readFileSync(path(ref), "utf8"), release = lockSync(path(ref), { realpath: false });
  const controller = new AbortController();
  try {
    const pending = archiveFundNav("270042", fundNav(), "fund_open_fund_info_em", NAV_OBSERVED_AT, null, controller.signal);
    controller.abort(new Error("cancel NAV commit"));
    await expect(pending).rejects.toThrow();
    expect(readFileSync(path(ref), "utf8")).toBe(before);
  } finally { release(); }
}, 20_000);
