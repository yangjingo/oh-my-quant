import { expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { QuantTui } from "../src/tui.ts";
import { createInitialAppState } from "../../../src/app-runtime.ts";

it.each([{ name: "c", ctrl: true }, { name: "d", ctrl: true }, { name: "escape", ctrl: false }])("routes $name exit through the host cleanup", key => {
  const root = mkdtempSync(join(tmpdir(), "whyj-exit-cleanup-")), previous = process.env.OHQUANT_DIR;
  process.env.OHQUANT_DIR = root;
  try {
    const tui = new QuantTui(createInitialAppState("fixture"));
    const submitted: string[] = [];
    tui.onSubmit(input => submitted.push(input));
    const input = tui as unknown as { handleKeyAction(action: { type: "key"; name: string; ctrl: boolean; shift: boolean; meta: boolean }): void };
    input.handleKeyAction({ type: "key", ...key, shift: false, meta: false });
    expect(submitted).toEqual(["/exit"]);
  } finally {
    if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-exit-cleanup-") || within.includes(sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
