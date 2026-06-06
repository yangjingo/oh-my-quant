import { describe, it, expect } from "bun:test";
import { parseCommand } from "./registry.ts";

describe("parseCommand", () => {
  it("returns null for non-command input", () => {
    expect(parseCommand("hello world")).toBeNull();
    expect(parseCommand("analyze AAPL")).toBeNull();
  });

  it("parses simple command", () => {
    const cmd = parseCommand("/help");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("help");
    expect(cmd!.raw).toBe("/help");
  });

  it("parses command with flags", () => {
    const cmd = parseCommand("/data download --symbol 000001.SZ --market A");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("data");
    expect(cmd!.flags).toEqual({ symbol: "000001.SZ", market: "A" });
    expect(cmd!.positional).toEqual(["download"]);
  });

  it("parses short flags", () => {
    const cmd = parseCommand("/claw -c 000001.SZ -m A");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("claw");
    expect(cmd!.flags).toEqual({ c: "000001.SZ", m: "A" });
  });

  it("parses boolean flags", () => {
    const cmd = parseCommand("/benchmark --force");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("benchmark");
    expect(cmd!.flags.force).toBe(true);
  });

  it("parses command with numeric flag", () => {
    const cmd = parseCommand("/backtest run --symbol 000001.SZ --fast 20 --slow 60");
    expect(cmd).not.toBeNull();
    expect(cmd!.flags.fast).toBe("20");
    expect(cmd!.flags.slow).toBe("60");
  });

  it("parses /exit", () => {
    const cmd = parseCommand("/exit");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("exit");
  });

  it("parses /quit as exit", () => {
    const cmd = parseCommand("/quit");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("quit");
  });

  it("parses /clear", () => {
    const cmd = parseCommand("/clear");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("clear");
  });

  it("ignores leading whitespace", () => {
    const cmd = parseCommand("  /help  ");
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toBe("help");
  });
});
