import { expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { QuantTui } from "../src/tui.ts";
import { createInitialAppState } from "../../../src/app-runtime.ts";
import type { SkillEntry } from "../../../src/types/skills.ts";

it("updates skill completion after loading and ignores a superseded scan", async () => {
  const root = mkdtempSync(join(tmpdir(), "whyj-skill-completion-")), previous = process.env.OHQUANT_DIR;
  process.env.OHQUANT_DIR = root;
  try {
    const tui = new QuantTui(createInitialAppState("fixture"));
    const input = tui as unknown as { inputBuf: string; currentSuggestions(): Array<{ fill: string }> };
    input.inputBuf = "/skill";
    let release!: (skills: SkillEntry[]) => void;
    const old = tui.refreshSkills(() => new Promise(resolve => { release = resolve; }));
    await tui.refreshSkills(async () => [{ name: "new-research", description: "New instructions", scope: "project" }]);
    release([{ name: "old-research", description: "Old instructions", scope: "project" }]);
    await old;
    expect(input.currentSuggestions().some(item => item.fill.includes("new-research"))).toBe(true);
    expect(input.currentSuggestions().some(item => item.fill.includes("old-research"))).toBe(false);
    await tui.refreshSkills(async () => { throw new Error("scan failed"); });
    expect(input.currentSuggestions().some(item => item.fill.includes("new-research"))).toBe(true);
    await tui.refreshSkills(async () => []);
    expect(input.currentSuggestions().some(item => item.fill.includes("new-research"))).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.OHQUANT_DIR; else process.env.OHQUANT_DIR = previous;
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!within.startsWith("whyj-skill-completion-") || within.includes(sep)) throw new Error("Unsafe cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
