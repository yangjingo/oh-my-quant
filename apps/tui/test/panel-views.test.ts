import { describe, expect, it } from "bun:test";
import { Buffer } from "../src/buffer.ts";
import { drawPanelFrame } from "../src/panel-chrome.ts";
import { renderArtifactPanelView, renderHelpPanelView, renderResumePanelView } from "../src/panel-views.ts";

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
        { name: "/resume", desc: "Browse and restore saved sessions", selected: true },
        { name: "/artifact", desc: "Browse, restore, and open reports", selected: false },
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
    expect(plain).toContain("Browse and restore saved sessions");
    expect(plain).toContain("Browse, restore, and open reports");
    expect(plain).toContain("Hotkeys");
    buf.clear();
    renderHelpPanelView(buf, drawPanelFrame(buf, "Help", ""), {
      commands: [], hotkeys: [{ key: "Ctrl+P", desc: "Open settings" }], section: "hotkeys", footer: "Hotkeys apply outside Help.",
    });
    expect(buf.toPlain().join("\n")).toContain("Ctrl+P");
    expect(buf.toPlain().join("\n")).toContain("Open settings");
  });


  it("renders artifact metadata through the shared artifact view", () => {
    const buf = new Buffer(120, 20);
    const frame = drawPanelFrame(buf, "Artifacts", "↑↓ select  ↵ restore & open  esc close");

    renderArtifactPanelView(buf, frame, {
      meta: {
        title: "Selected: Analysis artifact",
        details: "sess-artifact-1 · 3 messages · 2KB",
        subdetails: "2h ago",
      },
      items: [
        { age: "2h ago  ", title: "Analysis artifact", stats: "3 msg · 2KB", selected: true },
      ],
      footer: "↑↓ select  ↵ restore & open  esc close  ·  1 artifact",
    });

    const plain = buf.toPlain().join("\n");
    expect(plain).toContain("Selected: Analysis artifact");
    expect(plain).toContain("sess-artifact-1");
    expect(plain).toContain("3 msg");
  });
});
