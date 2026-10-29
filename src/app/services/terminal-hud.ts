import { createHash } from "node:crypto";
import type { QuantAgentEvent } from "../../agent/src/session-contracts.ts";
import type { OhQuantSettings } from "../../types/config.ts";
import { assistantEventHasVisibleOutput, computeTpotMs, extractAssistantOutputTokens } from "../../runtime/workspace/hud.ts";

/** Private scope only; neither settings nor their fingerprint leave the Host. */
export function terminalModelSettingsKey(settings: OhQuantSettings): string {
  return createHash("sha256").update(JSON.stringify([settings.provider, settings.model, settings.providers, settings.thinkingLevel, settings.env])).digest("hex");
}

/** Session-local, transient averages of the original Agent events. */
export class TerminalHudLatency {
  private scope = "";
  private settingsKey = "";
  private started: number | null = null;
  private first: number | null = null;
  private ttftTotal = 0;
  private ttftCount = 0;
  private tpotTotal = 0;
  private tpotCount = 0;

  reset(): void {
    this.scope = this.settingsKey = ""; this.started = this.first = null;
    this.ttftTotal = this.ttftCount = this.tpotTotal = this.tpotCount = 0;
  }

  observe(event: QuantAgentEvent, settingsKey: string, thinkingLevel: string | undefined, now = Date.now()): void {
    if (event.type === "before_provider_request") {
      const scope = createHash("sha256").update(JSON.stringify([event.sessionId, event.model.provider, event.model.id, event.model.baseUrl, thinkingLevel, settingsKey])).digest("hex");
      if (scope !== this.scope) this.reset();
      this.scope = scope; this.settingsKey = settingsKey; this.started = now; this.first = null;
    } else if (event.type === "message_start" && (event.message.role === "user" || event.message.role === "displayUser")) {
      this.started = now; this.first = null;
    } else if (event.type === "message_update" && event.message.role === "assistant" && this.started !== null && this.first === null
      && assistantEventHasVisibleOutput(event.assistantMessageEvent)) {
      this.first = now;
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      const success = event.message.stopReason !== "error" && event.message.stopReason !== "aborted";
      if (success && this.started !== null && this.first !== null) {
        this.ttftTotal += Math.max(0, this.first - this.started); this.ttftCount++;
        const tpot = computeTpotMs(now - this.first, extractAssistantOutputTokens(event.message));
        if (tpot !== null) { this.tpotTotal += tpot; this.tpotCount++; }
      }
      this.started = this.first = null;
    }
  }

  snapshot(settingsKey: string): { ttftMs: number | null; tpotMs: number | null } {
    if (settingsKey !== this.settingsKey) return { ttftMs: null, tpotMs: null };
    return { ttftMs: this.ttftCount ? this.ttftTotal / this.ttftCount : null, tpotMs: this.tpotCount ? this.tpotTotal / this.tpotCount : null };
  }
}
