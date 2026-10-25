import { describe, expect, it } from "bun:test";
import { buildArtifactPanelData, buildHelpPanelData, buildResumePanelData } from "../src/panel-models.ts";

describe("panel models", () => {
  it("builds resume panel data with current-session usage and legacy archive markers", () => {
    const data = buildResumePanelData({
      sessions: [
        {
          id: "sess-1",
          sessionName: "sess-1",
          cwd: "C:\\repo",
          path: "C:\\repo\\sess-1.jsonl",
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T01:00:00.000Z",
          preview: "current preview",
          recentMessages: [{ role: "user", text: "hello" }],
          messageCount: 1,
          format: "jsonl",
        },
        {
          id: "sess-2",
          sessionName: "sess-2",
          cwd: "C:\\other",
          path: "C:\\other\\sess-2.md",
          createdAt: "2026-06-17T00:00:00.000Z",
          updatedAt: "2026-06-17T01:00:00.000Z",
          preview: "legacy preview",
          recentMessages: [],
          messageCount: 2,
          format: "markdown",
        },
      ],
      selection: 0,
      currentSessionMeta: {
        id: "sess-1",
        createdAt: "2026-06-18T00:00:00.000Z",
        usage: { tokens: 400, contextWindow: 1000, percent: 40 },
        entryCount: { messages: 10, compactions: 1, branches: 0 },
      },
      resumeFilter: "all",
      resumeSort: "updated",
      status: "",
      innerWidth: 80,
      formatRelativeAge: () => "1h ago",
    });

    expect(data.meta?.title).toContain("Current: sess-1");
    expect(data.meta?.usageBar).toContain("400/1,000");
    expect(data.meta?.stats).toContain("Msgs 10");
    expect(data.items[1]?.legacy).toBe(true);
    expect(data.footer).toBe("2 sessions");
  });

  it("builds resume panel data with historical JSONL context usage", () => {
    const data = buildResumePanelData({
      sessions: [
        {
          id: "current-session",
          cwd: "C:\\repo",
          path: "C:\\repo\\current.jsonl",
          createdAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T01:00:00.000Z",
          preview: "current preview",
          recentMessages: [],
          messageCount: 1,
          format: "jsonl",
        },
        {
          id: "history-session",
          cwd: "C:\\repo",
          path: "C:\\repo\\history.jsonl",
          createdAt: "2026-06-17T00:00:00.000Z",
          updatedAt: "2026-06-17T01:00:00.000Z",
          preview: "historical preview",
          recentMessages: [{ role: "assistant", text: "historical answer" }],
          messageCount: 4,
          format: "jsonl",
          contextUsage: { tokens: 750, contextWindow: 1000, percent: 75 },
          entryCount: { messages: 4, compactions: 1, branches: 2 },
        },
      ],
      selection: 1,
      currentSessionMeta: {
        id: "current-session",
        createdAt: "2026-06-18T00:00:00.000Z",
        usage: { tokens: 100, contextWindow: 1000, percent: 10 },
        entryCount: { messages: 1, compactions: 0, branches: 0 },
      },
      resumeFilter: "cwd",
      resumeSort: "updated",
      status: "",
      innerWidth: 80,
      formatRelativeAge: () => "1d ago",
    });

    expect(data.meta?.title).toContain("Selected: history-session");
    expect(data.meta?.usageBar).toContain("750/1,000");
    expect(data.meta?.usageCritical).toBe(false);
    expect(data.meta?.stats).toContain("Msgs 4");
    expect(data.meta?.stats).toContain("Comps 1");
    expect(data.meta?.stats).toContain("Branches 2");
  });

  it("builds artifact panel data with selected metadata", () => {
    const data = buildArtifactPanelData({
      items: [
        {
          sessionId: "sess-artifact-1",
          title: "Analysis artifact",
          createdAt: "2026-06-18T00:00:00.000Z",
          messageCount: 3,
          bytes: 2048,
        },
      ],
      selection: 0,
      status: "",
      formatRelativeAge: () => "2h ago",
    });

    expect(data.meta?.title).toContain("Analysis artifact");
    expect(data.meta?.details).toContain("sess-artifact-1");
    expect(data.items[0]?.stats).toContain("2KB");
    expect(data.footer).toContain("1 report");
  });
  it("builds help panel data with a selected command", () => {
    const data = buildHelpPanelData(0);
    expect(data.commands.some((cmd) => cmd.selected)).toBe(true);
    expect(data.hotkeys.some((key) => key.key === "Ctrl+P")).toBe(true);
    expect(data.footer).toBe("Usage: /help compact");
  });
});
