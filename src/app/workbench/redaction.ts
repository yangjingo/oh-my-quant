/** Withhold a trailing protected prefix until a streamed value can be safely classified. */
export function redactModelText(text: string, secrets: readonly string[], streaming = false): string {
  let held = 0;
  if (streaming) {
    // Check the original text before replacing overlapping values: a credential can be part of a path.
    for (const secret of secrets) for (let length = Math.min(secret.length - 1, text.length); length > held; length--) {
      if (text.endsWith(secret.slice(0, length))) { held = length; break; }
    }
  }
  const visible = held ? text.slice(0, -held) : text;
  // A longer protected value must be replaced before a credential contained inside it.
  return [...secrets].sort((a, b) => b.length - a.length)
    .reduce((value, secret) => secret ? value.split(secret).join("[REDACTED]") : value, visible);
}
