import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PanelController } from "../src/panel.ts";
import { savePanelPortfolio } from "../../storage/panel-portfolio.ts";

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

describe("PanelController portfolio UI", () => {
  it("adds a symbol through draft input and refreshes panel", () => {
    const panel = new PanelController();
    panel.open();
    const fields = panel["fields"]() as Array<{ label: string }>;
    const addIdx = fields.findIndex((f) => f.label === "Add symbol");
    expect(addIdx).toBeGreaterThan(-1);
    panel["cursor"] = addIdx;

    expect(panel.handleKey("", key("return"))).toEqual({});
    expect(panel.handleKey("5", key("", "5"))).toEqual({});
    expect(panel.handleKey("1", key("", "1"))).toEqual({});
    const result = panel.handleKey("", key("return"));
    expect(result?.refreshPanel).toBe(true);
    panel.close();
  });

  it("creates a group through draft input and refreshes panel", () => {
    const panel = new PanelController();
    panel.open();
    const fields = panel["fields"]() as Array<{ label: string }>;
    const createIdx = fields.findIndex((f) => f.label === "Create group");
    expect(createIdx).toBeGreaterThan(-1);
    panel["cursor"] = createIdx;

    expect(panel.handleKey("", key("return"))).toEqual({});
    expect(panel.handleKey("科", key("", "科"))).toEqual({});
    expect(panel.handleKey("技", key("", "技"))).toEqual({});
    expect(panel.handleKey("组", key("", "组"))).toEqual({});
    const result = panel.handleKey("", key("return"));
    expect(result?.refreshPanel).toBe(true);
    panel.close();
  });

  it("navigates group selection with left/right arrows", () => {
    const panel = new PanelController();
    panel.open();
    const fields = panel["fields"]() as Array<{ label: string }>;
    const createIdx = fields.findIndex((f) => f.label === "Create group");
    panel["cursor"] = createIdx;

    // Create first group
    panel.handleKey("", key("return"));
    for (const char of "组1") panel.handleKey(char, key("", char));
    panel.handleKey("", key("return"));

    // Create second group
    panel.handleKey("", key("return"));
    for (const char of "组2") panel.handleKey(char, key("", char));
    panel.handleKey("", key("return"));

    // Navigate to Selected group field
    const selectIdx = fields.findIndex((f) => f.label === "Selected group");
    panel["cursor"] = selectIdx;
    expect(panel["groupPick"]).toBe(0);

    // Navigate right to select second group
    panel.handleKey("", key("right"));
    expect(panel["groupPick"]).toBe(1);

    // Navigate left to select first group
    panel.handleKey("", key("left"));
    expect(panel["groupPick"]).toBe(0);

    panel.close();
  });
});
