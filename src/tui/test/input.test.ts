import { describe, expect, it } from "bun:test";
import { buildSuggestions, hitTestScrollRegion, nextInputAction } from "../src/input.ts";
import type { Layout } from "../src/types.ts";

describe("nextInputAction", () => {
  it("parses printable input", () => {
    const { action, rest } = nextInputAction("a");
    expect(rest).toBe("");
    expect(action).toEqual({ type: "key", name: "", shift: false, ctrl: false, meta: false, char: "a" });
  });

  it("parses page keys and shift modifiers", () => {
    expect(nextInputAction("\x1b[5~").action).toMatchObject({ type: "key", name: "pageup", shift: false });
    expect(nextInputAction("\x1b[6;2~").action).toMatchObject({ type: "key", name: "pagedown", shift: true });
  });

  it("buffers incomplete CSI sequences", () => {
    const { action, rest } = nextInputAction("\x1b[<64;10;");
    expect(action).toBeNull();
    expect(rest).toBe("\x1b[<64;10;");
  });

  it("parses SGR mouse wheel events", () => {
    const { action, rest } = nextInputAction("\x1b[<64;10;5M");
    expect(rest).toBe("");
    expect(action).toMatchObject({
      type: "mouse",
      events: [{ col: 9, row: 4, wheel: -1, dragging: false }],
    });
  });

  it("discards bare mouse fragments before they reach composer", () => {
    const { action, rest } = nextInputAction("35;135;57M");
    expect(rest).toBe("");
    expect(action).toMatchObject({ type: "mouse" });
  });
});

describe("hitTestScrollRegion", () => {
  const L: Layout = {
    mainPane: { x: 0, y: 3, w: 80, h: 20 },
    conversation: { x: 1, y: 3, w: 78, h: 20 },
    portfolio: { x: 80, y: 3, w: 40, h: 20 },
    composer: { x: 0, y: 23, w: 120, h: 8 },
    statusRow: 31,
    showPanel: true,
  };

  it("routes points to conversation, overview, or composer", () => {
    expect(hitTestScrollRegion(10, 10, L)).toBe("conversation");
    expect(hitTestScrollRegion(90, 10, L)).toBe("overview");
    expect(hitTestScrollRegion(10, 25, L)).toBe("composer");
  });
});

describe("buildSuggestions", () => {
  const watchlist = [
    { code: "000001.SZ", name: "平安银行" },
    { code: "510300.SH", name: "沪深300ETF" },
  ];

  it("suggests slash commands", () => {
    expect(buildSuggestions("/mc", watchlist)).toEqual([
      { label: "/mcp  Connect to data servers", fill: "/mcp" },
    ]);
  });

  it("suggests command actions for exact command names", () => {
    expect(buildSuggestions("/mcp", watchlist).map((s) => s.fill)).toEqual(["/mcp", "/mcp connect"]);
  });

  it("suggests watchlist codes and names inside flags", () => {
    expect(buildSuggestions("/data download --symbol 000", watchlist)[0]).toEqual({
      label: "000001  平安银行",
      fill: "/data download --symbol 000001.SZ",
    });
    expect(buildSuggestions("/add stock --name 沪深", watchlist)[0]).toEqual({
      label: "沪深300ETF",
      fill: "/add stock --name 沪深300ETF",
    });
  });
});
