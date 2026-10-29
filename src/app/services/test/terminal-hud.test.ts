import { expect, test } from "bun:test";
import type { QuantAgentEvent } from "../../../agent/src/session-contracts.ts";
import { TerminalHudLatency } from "../terminal-hud.ts";

const event = (value: unknown) => value as QuantAgentEvent;
const request = (id = "model") => event({ type: "before_provider_request", sessionId: "session", model: { id, provider: "fixture", baseUrl: "http://local" } });
const delta = event({ type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "x" } });
const end = (output: number, stopReason = "stop") => event({ type: "message_end", message: { role: "assistant", usage: { output }, stopReason } });

test("terminal latency averages completed visible turns and isolates model/config scopes", () => {
  const hud = new TerminalHudLatency();
  expect(hud.snapshot("config-a")).toEqual({ ttftMs: null, tpotMs: null });
  hud.observe(request(), "config-a", "off", 1000); hud.observe(delta, "config-a", "off", 1100); hud.observe(end(6), "config-a", "off", 1500);
  expect(hud.snapshot("config-a")).toEqual({ ttftMs: 100, tpotMs: 80 });
  hud.observe(request(), "config-a", "off", 2000); hud.observe(delta, "config-a", "off", 2300); hud.observe(end(3), "config-a", "off", 2500);
  expect(hud.snapshot("config-a")).toEqual({ ttftMs: 200, tpotMs: 90 });
  hud.observe(request(), "config-a", "off", 3000); hud.observe(delta, "config-a", "off", 3100); hud.observe(end(5, "aborted"), "config-a", "off", 3500);
  expect(hud.snapshot("config-a")).toEqual({ ttftMs: 200, tpotMs: 90 });
  expect(hud.snapshot("config-b")).toEqual({ ttftMs: null, tpotMs: null });
  hud.observe(request(), "config-b", "off", 4000); hud.observe(delta, "config-b", "off", 4050); hud.observe(end(1), "config-b", "off", 4100);
  expect(hud.snapshot("config-b")).toEqual({ ttftMs: 50, tpotMs: null });
  hud.observe(request("other-model"), "config-b", "off", 5000);
  expect(hud.snapshot("config-b")).toEqual({ ttftMs: null, tpotMs: null });
  hud.reset(); expect(hud.snapshot("config-b")).toEqual({ ttftMs: null, tpotMs: null });
});
