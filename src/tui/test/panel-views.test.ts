import { Buffer } from "../src/buffer.ts";
import { drawPanelFrame } from "../src/panel-chrome.ts";
import { renderHelpPanelView, renderResumePanelView } from "../src/panel-views.ts";

describe("panel views", () => {
  it("renders resume metadata and legacy archive markers through the shared resume view", () => {
    const buf = new Buffer(120, 28);
    const frame = drawPanelFrame(buf, "Resume a previous session", "↑↓ move  ↵ resume  esc close");

    renderResumePanelView(buf, frame, {
      meta: {
        title: "Current: sess-1  ·  2026-06-18T00:00:00Z",
        usageBar: "████░░░░  400/1000 (40%)",
        usageCritical: false,
        stats: "Msgs 12  Comps 1  Branches 0",
        previewLines: ["U: first", "A: second"],
      },
      items: [
        { age: "1h ago    ", preview: "Current session preview", selected: true },
        { age: "2d ago    ", preview: "Legacy markdown preview", selected: false, legacy: true, secondary: "C:\\tmp\\other" },
      ],
      footer: "Showing 2 sessions · enter to resume",
    });

    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Current: sess-1");
    expect(plain).toContain("Msgs 12  Comps 1  Branches 0");
    expect(plain).toContain("[legacy]");
    expect(plain).toContain("Legacy markdown preview");
  });

  it("renders help commands and hotkeys through the shared help view", () => {
    const buf = new Buffer(120, 28);
    const frame = drawPanelFrame(buf, "Help", "↑↓ select  ↵ run  esc close");

    renderHelpPanelView(buf, frame, {
      commands: [
        { name: "/resume", desc: "Resume a session", selected: true },
        { name: "/config", desc: "Open settings", selected: false },
      ],
      hotkeys: [
        { key: "Ctrl+P", desc: "Open settings" },
        { key: "Tab", desc: "Accept suggestion" },
      ],
      footer: "↑↓ select  ↵ run  esc close",
    });

    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Commands");
    expect(plain).toContain("/resume");
    expect(plain).toContain("Hotkeys");
    expect(plain).toContain("Ctrl+P");
  });
});
