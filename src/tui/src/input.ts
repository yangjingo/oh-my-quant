import type { Layout } from "./types.ts";
import type { CodeEntry } from "./watchlist.ts";
import { COMMAND_CATALOG } from "../../cli/catalog.ts";
import type { SkillEntry } from "../../skill/types.ts";

export type ScrollRegion = "composer" | "conversation" | "overview";

export interface ComposerSuggestion {
  label: string;
  fill: string;
}

export type { SkillEntry };

export interface MouseEvent {
  col: number;
  row: number;
  kind: "press" | "release" | "motion";
  button: number;
  wheel: -1 | 0 | 1;
  dragging: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
}

export type InputAction =
  | { type: "mouse"; events: MouseEvent[] }
  | { type: "key"; name: string; shift: boolean; ctrl: boolean; meta: boolean; char?: string }
  | { type: "discard" };

export function hitTestScrollRegion(col: number, row: number, L: Layout): ScrollRegion {
  const inRect = (r: { x: number; y: number; w: number; h: number }) =>
    col >= r.x && col < r.x + r.w && row >= r.y && row < r.y + r.h;
  if (L.showPanel && inRect(L.portfolio)) return "overview";
  if (inRect(L.mainPane)) return "conversation";
  return "composer";
}

function decodeMouse(btn: number): Pick<MouseEvent, "button" | "wheel" | "dragging" | "kind" | "shift" | "ctrl" | "meta"> {
  const shift = (btn & 4) !== 0;
  const meta = (btn & 8) !== 0;
  const ctrl = (btn & 16) !== 0;
  let b = btn;
  if (shift) b -= 4;
  if (meta) b -= 8;
  if (ctrl) b -= 16;
  const mods = { shift, ctrl, meta };
  if (b === 64 || b === 65) return { button: 0, wheel: b === 64 ? -1 : 1, dragging: false, kind: "motion", ...mods };
  if (b >= 33 && b <= 35) return { button: b - 33, wheel: 0, dragging: true, kind: "motion", ...mods };
  if (b === 32) return { button: 0, wheel: 0, dragging: false, kind: "motion", ...mods };
  if (b === 3) return { button: 0, wheel: 0, dragging: false, kind: "release", ...mods };
  return { button: b, wheel: 0, dragging: false, kind: "press", ...mods };
}

function readMouse(buf: string): { events: MouseEvent[]; rest: string } | null {
  const events: MouseEvent[] = [];
  let rest = buf;
  while (rest.length > 0) {
    const m = /^(?:\x1b\[<)?(\d+);(\d+);(\d+)([Mm])/.exec(rest);
    if (!m) break;
    const decoded = decodeMouse(Number(m[1]));
    events.push({
      ...decoded,
      col: Number(m[2]) - 1,
      row: Number(m[3]) - 1,
      kind: m[4] === "m" ? "release" : decoded.kind === "motion" ? "motion" : "press",
    });
    rest = rest.slice(m[0].length);
  }
  return events.length > 0 ? { events, rest } : null;
}

function readCsi(buf: string): { len: number; name: string; shift: boolean; ctrl: boolean } | null {
  const m = /^\x1b\[(\d*(?:;\d+)*)?([A-Za-z~])/.exec(buf);
  if (!m) return null;
  const nums = m[1]?.split(";").filter(Boolean).map(Number) ?? [];
  const modifier = nums.length > 1 ? nums[nums.length - 1] : 1;
  const shift = [2, 4, 6, 8].includes(modifier);
  const ctrl = [5, 6, 7, 8].includes(modifier);
  const map: Record<string, string> = { A: "up", B: "down", C: "right", D: "left", H: "home", F: "end", Z: "tab" };
  const name = m[2] === "~" ? ({ 5: "pageup", 6: "pagedown" } as Record<number, string>)[nums[0]] ?? `${nums[0]}~` : map[m[2]] ?? m[2];
  return { len: m[0].length, name, shift: m[2] === "Z" || shift, ctrl };
}

function waitForMore(buf: string): boolean {
  return buf.startsWith("\x1b[") && buf.length < 16 && /^\x1b\[<?[\d;]*$/.test(buf);
}

export function nextInputAction(buf: string): { action: InputAction | null; rest: string } {
  if (!buf) return { action: null, rest: "" };

  const mouse = readMouse(buf);
  if (mouse) return { action: { type: "mouse", events: mouse.events }, rest: mouse.rest };
  if (/^\d+;\d+;\d+[Mm]?/.test(buf)) {
    const leak = /^\d+;\d+;\d+[Mm]?/.exec(buf)![0];
    return { action: { type: "discard" }, rest: buf.slice(leak.length) };
  }
  if (waitForMore(buf)) return { action: null, rest: buf };

  if (buf[0] === "\x1b") {
    if (buf.length === 1) return { action: key("escape"), rest: "" };
    const csi = readCsi(buf);
    if (csi) return { action: key(csi.name, { shift: csi.shift, ctrl: csi.ctrl }), rest: buf.slice(csi.len) };
    return { action: { type: "discard" }, rest: buf.slice(1) };
  }

  const single: Record<string, string> = { "\r": "return", "\n": "return", "\x7f": "backspace", "\b": "backspace", "\t": "tab" };
  const control: Record<string, string> = { "\x03": "c", "\x04": "d", "\x10": "p" };
  const ch = Array.from(buf)[0];
  if (single[ch]) return { action: key(single[ch]), rest: buf.slice(ch.length) };
  if (control[ch]) return { action: key(control[ch], { ctrl: true }), rest: buf.slice(ch.length) };
  if (ch >= " " && ch !== "\x7f") return { action: key("", { char: ch }), rest: buf.slice(ch.length) };
  return { action: { type: "discard" }, rest: buf.slice(ch.length) };
}

function key(name: string, opts: Partial<Omit<Extract<InputAction, { type: "key" }>, "type" | "name">> = {}): InputAction {
  return { type: "key", name, shift: false, ctrl: false, meta: false, ...opts };
}

export function buildSuggestions(value: string, watchlist: CodeEntry[], skills: SkillEntry[] = []): ComposerSuggestion[] {
  if (!value || value.startsWith(" ")) return [];

  function skillSuggestion(s: SkillEntry): ComposerSuggestion {
    const scope = s.scope === "user" ? "[u]" : "[p]";
    return { label: `skill:${s.name}  ${scope} ${s.description}`, fill: `/skill:${s.name} ` };
  }

  // /skill:name suggestions (before catalog check — /skill: doesn't match any catalog entry)
  const skillMatch = value.match(/^\/skill:(\S*)$/);
  if (skillMatch) {
    const partial = skillMatch[1].toLowerCase();
    return skills
      .filter((s) => !partial || s.name.toLowerCase().includes(partial))
      .map(skillSuggestion);
  }

  if (value.startsWith("/")) {
    const command = value.match(/^\/\S+/)?.[0] ?? "";
    if (command && !COMMAND_CATALOG.some((c) => c.name === command || c.name.startsWith(command))) return [];
  }

  const codeMatch = value.match(/^(.+--(code|symbol)\s+)(\S*)$/i);
  if (codeMatch) {
    const prefix = codeMatch[1], partial = codeMatch[3].toLowerCase();
    return partial ? watchlist
      .filter((c) => c.code.toLowerCase().includes(partial) || c.name.toLowerCase().includes(partial))
      .slice(0, 8)
      .map((c) => ({ label: `${c.code.split(".")[0]}  ${c.name}`, fill: prefix + c.code })) : [];
  }

  const nameMatch = value.match(/^(.+--name\s+)(\S*)$/i);
  if (nameMatch) {
    const prefix = nameMatch[1], partial = nameMatch[2].toLowerCase();
    return partial ? watchlist
      .filter((c) => c.name.toLowerCase().includes(partial))
      .slice(0, 8)
      .map((c) => ({ label: c.name, fill: prefix + c.name })) : [];
  }

  if (!value.startsWith("/")) return [];

  const subMatch = value.match(/^(\/\S+)\s+(\S*)$/);
  if (subMatch) {
    const entry = COMMAND_CATALOG.find((c) => c.name === subMatch[1]);
    const partial = subMatch[2].toLowerCase();
    if (entry?.subcommands?.length) {
      return entry.subcommands
        .filter((sub) => !partial || sub.toLowerCase().startsWith(partial))
        .slice(0, 8)
        .map((sub) => ({ label: sub, fill: `${entry.name} ${sub} ` }));
    }
  }

  const exact = COMMAND_CATALOG.find((c) => c.name === value);
  if (exact) {
    if (exact.actions?.length) return [...exact.actions];
    if (exact.subcommands?.length) {
      return exact.subcommands
        .slice(0, 8)
        .map((sub) => ({ label: sub, fill: `${exact.name} ${sub} ` }));
    }
    // /skill — show all skills as suggestions
    if (exact.name === "/skill") {
      return skills.map(skillSuggestion);
    }
    return [];
  }
  const lower = value.toLowerCase();
  const catalogMatches = COMMAND_CATALOG.filter((c) => c.name.toLowerCase().startsWith(lower));
  // When partial-matching /skill, show skill suggestions
  if (catalogMatches.length === 1 && catalogMatches[0].name === "/skill") {
    return skills.map(skillSuggestion);
  }
  return catalogMatches.map((c) => ({ label: `${c.name}  ${c.desc}`, fill: c.name }));
}
