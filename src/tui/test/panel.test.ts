import { describe, expect, it } from "bun:test";
import { PanelController } from "../src/panel.ts";

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
});
