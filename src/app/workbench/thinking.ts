/** Project only provider-returned display text, never opaque or redacted blocks. */
export function thinkingText(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content;
  return Array.isArray(content) ? content.filter(part => part?.type === "thinking" && typeof part.thinking === "string"
    && (part.redacted === undefined || part.redacted === false)).map(part => part.thinking).join("\n\n") : "";
}

/** Hold a trailing secret prefix during streaming so a split credential is never exposed. */
export function redactModelText(text: string, secrets: readonly string[], streaming = false): string {
  let safe = secrets.reduce((value, secret) => secret ? value.split(secret).join("[REDACTED]") : value, text);
  if (!streaming) return safe;
  let held = 0;
  for (const secret of secrets) {
    for (let length = Math.min(secret.length - 1, safe.length); length > held; length--) {
      if (safe.endsWith(secret.slice(0, length))) { held = length; break; }
    }
  }
  if (held) safe = safe.slice(0, -held);
  return safe;
}
