import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runCheckoutCommand, withResourceCheckout } from "./resource-checkout.ts";

const repo = resolve(import.meta.dir, "../../../..");
const git = (cwd: string, args: string[]) => runCheckoutCommand(cwd, ["git", ...args]);

test("a sparse pinned clone preserves caller worktrees/config/dependencies and removes its own fixture", async () => {
  const before = await git(repo, ["worktree", "list", "--porcelain"]);
  const configPath = await git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const config = readFileSync(join(configPath, "config"), "utf8");
  const revision = await git(repo, ["rev-parse", "HEAD"]);
  let scratch = "";
  await withResourceCheckout(repo, async fixture => {
    scratch = fixture.scratch;
    expect(await git(fixture.checkout, ["rev-parse", "HEAD"])).toBe(revision);
    expect(await git(fixture.checkout, ["status", "--porcelain", "--untracked-files=no"])).toBe("");
    for (const required of ["src/runtime/quant-harness.ts", "src/app/services/research.ts", "bun.lock", "package.json"])
      expect(existsSync(join(fixture.checkout, required))).toBe(true);
    for (const excluded of ["apps", "site", "docs"]) expect(existsSync(join(fixture.checkout, excluded))).toBe(false);
    expect(realpathSync(join(fixture.checkout, "node_modules"))).toBe(realpathSync(join(repo, "node_modules")));
  });
  expect(existsSync(scratch)).toBe(false);
  expect(await git(repo, ["worktree", "list", "--porcelain"])).toBe(before);
  expect(readFileSync(join(configPath, "config"), "utf8")).toBe(config);
  expect(existsSync(join(repo, "node_modules", "bun-types", "package.json"))).toBe(true);
}, 30_000);

test("a partial clone failure retains the original diagnostic and safely removes only its scratch", async () => {
  const original = new Error("Git clone failed: synthetic stderr and exit=7"); let scratch = "", invoked = false;
  let observed: unknown;
  try {
    await withResourceCheckout(repo, async () => { invoked = true; }, { git: async (_cwd, args) => {
      if (args[0] === "rev-parse") return "fixture-revision";
      const checkout = args.at(-1)!; scratch = dirname(checkout);
      mkdirSync(checkout); writeFileSync(join(checkout, "partial"), "incomplete"); throw original;
    } });
  } catch (error) { observed = error; }
  expect(observed).toBe(original); expect(invoked).toBe(false); expect(existsSync(scratch)).toBe(false);
});

test("cleanup failure preserves the primary failure and identifies retained evidence", async () => {
  const original = new Error("original setup error"), cleanup = new Error("synthetic cleanup failure");
  let scratch = "", observed: unknown;
  try {
    await withResourceCheckout(repo, async () => {}, { git: async () => { throw original; }, remove: root => { scratch = root; throw cleanup; } });
  } catch (error) { observed = error; }
  try {
    expect(observed).toBeInstanceOf(AggregateError);
    expect((observed as AggregateError).errors).toEqual([original, cleanup]);
    expect((observed as AggregateError).cause).toBe(original);
    expect((observed as Error).message).toContain(scratch);
    expect(existsSync(scratch)).toBe(true);
  } finally {
    // The injected remover received the helper's already validated owned root.
    if (scratch) rmSync(scratch, { recursive: true });
  }
});

test("bounded fixture commands report stderr/exit and await a killed child before returning", async () => {
  await expect(runCheckoutCommand(repo, [process.execPath, "-e", 'console.error("synthetic diagnostic");process.exit(7)']))
    .rejects.toThrow("synthetic diagnostic");
  await expect(runCheckoutCommand(repo, [process.execPath, "-e", 'setInterval(() => {}, 1000)'], 100))
    .rejects.toThrow("budgetMs=100");
});
