import type { Key } from "node:readline";
import { Buffer } from "./buffer.ts";
import { drawPanelFrame } from "./panel-chrome.ts";
import { buildHelpPanelData } from "./panel-models.ts";
import { renderHelpPanelView } from "./panel-views.ts";
import { DEFAULT_APP_KEYBINDINGS } from "./model-settings-panel.ts";

type Bindings = Pick<typeof DEFAULT_APP_KEYBINDINGS, "previous" | "next" | "confirm" | "cancel" | "helpSection" | "helpUsage">;

/** Local command discovery; looking at a shortcut never dispatches it. */
export class HelpPanel {
  private section: "commands" | "hotkeys" = "commands";
  private commandSelection = 0;
  private hotkeySelection = 0;
  private readonly bindings: Bindings;

  constructor(bindings: Partial<Bindings> = {}) { this.bindings = { ...DEFAULT_APP_KEYBINDINGS, ...bindings }; }

  handleKey(input: string, key: Key): { command?: string; close?: boolean } {
    const chord = `${key.ctrl ? "ctrl+" : ""}${key.meta ? "meta+" : ""}${key.shift ? "shift+" : ""}${key.name || input.toLowerCase()}`;
    if (this.bindings.cancel.includes(chord)) return { close: true };
    if (this.bindings.helpSection.includes(chord)) {
      this.section = this.section === "commands" ? "hotkeys" : "commands";
      return {};
    }
    const data = buildHelpPanelData(this.commandSelection);
    if (this.bindings.previous.includes(chord) || this.bindings.next.includes(chord)) {
      const delta = this.bindings.previous.includes(chord) ? -1 : 1;
      if (this.section === "commands") this.commandSelection = (this.commandSelection + delta + data.commands.length) % data.commands.length;
      else this.hotkeySelection = (this.hotkeySelection + delta + data.hotkeys.length) % data.hotkeys.length;
    } else if (this.section === "commands") {
      const command = data.commands[this.commandSelection]?.name;
      if (command && this.bindings.helpUsage.includes(chord)) return { command: `/help ${command.slice(1)}`, close: true };
      if (command && this.bindings.confirm.includes(chord)) return { command, close: true };
    }
    return {};
  }

  render(buf: Buffer): void {
    const data = buildHelpPanelData(this.commandSelection);
    renderHelpPanelView(buf, drawPanelFrame(buf, "Help", "", 3, 1), {
      ...data, section: this.section, hotkeySelection: this.hotkeySelection,
      footer: this.section === "commands" ? data.footer : "Hotkeys apply outside Help.",
      controls: `${this.bindings.previous[0]}/${this.bindings.next[0]} select · ${this.bindings.helpSection[0]} switch · ${this.bindings.cancel[0]} close`,
      actionHint: this.section === "commands" ? `${this.bindings.confirm[0]} run · ${this.bindings.helpUsage[0]} usage` : "Read-only shortcut reference",
    });
  }
}
