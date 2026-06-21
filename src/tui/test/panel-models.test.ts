import { buildHelpPanelData, buildPortfolioPanelData, buildResumePanelData } from "../src/panel-models.ts";

describe("panel models", () => {
  it("builds resume panel data with current-session usage and legacy archive markers", () => {
    const data = buildResumePanelData({
      sessions: [
        {
          id: "sess-1",
          sessionName: "sess-1",
          cwd: "C:\\repo",
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
    expect(data.footer).toContain("Showing 2 sessions");
  });

  it("builds portfolio panel data with active markers and empty footer fallback", () => {
    const data = buildPortfolioPanelData({
      items: [
        {
          fileName: "holdings.json",
          name: "主组合",
          updated: "2026-06-18T00:00:00.000Z",
          strategy: "Core",
          riskTag: "Medium",
          count: 3,
          focusSectors: ["AI"],
          holdings: [],
        },
      ],
      selection: 0,
      activeFile: "holdings.json",
      status: "",
      formatRelativeAge: () => "2h ago",
    });

    expect(data.meta?.title).toContain("Active: 主组合");
    expect(data.items[0]?.active).toBe(true);
    expect(data.footer).toContain("1 portfolio");
  });

  it("builds help panel data with a selected command", () => {
    const data = buildHelpPanelData(0);
    expect(data.commands.some((cmd) => cmd.selected)).toBe(true);
    expect(data.hotkeys.some((key) => key.key === "Ctrl+P")).toBe(true);
  });
});
