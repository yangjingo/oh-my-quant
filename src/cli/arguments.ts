import type { ParsedCommand } from "./types.ts";

export interface SlashArgument { value: string; quoted: boolean }

/** Whole-value quotes group literal text. Backslashes and quotes inside bare words stay literal. */
export function tokenizeSlashArguments(input: string): { tokens: SlashArgument[]; error?: string } {
  const tokens: SlashArgument[] = [];
  let index = 0;
  while (index < input.length) {
    if (/\s/.test(input[index]!)) { index++; continue; }
    const quote = input[index], quoted = quote === '"' || quote === "'";
    if (quoted) {
      const start = ++index;
      while (index < input.length && input[index] !== quote) index++;
      tokens.push({ value: input.slice(start, index), quoted: true });
      if (index === input.length) return { tokens, error: "Unclosed quoted argument; close the matching quote before submitting." };
      index++;
      if (index < input.length && !/\s/.test(input[index]!)) return { tokens, error: "Separate a quoted argument from the next argument with whitespace." };
    } else {
      const start = index;
      while (index < input.length && !/\s/.test(input[index]!)) index++;
      tokens.push({ value: input.slice(start, index), quoted: false });
    }
  }
  return { tokens };
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const { tokens: parts, error } = tokenizeSlashArguments(trimmed.slice(1));
  if (parts.length === 0) return null;
  let command = parts[0]!.value;
  let colonArg = "";
  const colonIdx = command.indexOf(":");
  if (colonIdx > 0) {
    colonArg = command.slice(colonIdx + 1);
    command = command.slice(0, colonIdx);
  }
  if (command === "session") command = "resume";
  const flags: Record<string, string | number | boolean> = Object.create(null);
  let argumentError = error ?? (!command ? "Missing command name." : undefined);
  const positional: string[] = colonArg ? [colonArg] : [];
  let i = 1;
  while (i < parts.length) {
    const { value: part, quoted } = parts[i]!;
    const next = parts[i + 1];
    const hasValue = next && (next.quoted || !next.value.startsWith("--") && !/^-[A-Za-z]$/.test(next.value));
    if (!quoted && (part.startsWith("--") || /^-[A-Za-z]$/.test(part))) {
      const key = part.slice(part.startsWith("--") ? 2 : 1);
      if (Object.hasOwn(flags, key)) argumentError = `Duplicate option ${part}.`;
      if (hasValue) {
        i++; flags[key] = parts[i]!.value;
      } else flags[key] = true;
    } else {
      positional.push(part);
    }
    i++;
  }
  return { command, raw: trimmed, flags, positional, ...(argumentError ? { argumentError } : {}) };
}
