/** Withhold a trailing credential prefix until a streamed value can be safely classified. */
export function redactModelText(text: string, secrets: readonly string[], streaming = false): string {
  let safe = secrets.reduce((value, secret) => secret ? value.split(secret).join("[REDACTED]") : value, text);
  if (!streaming) return safe;
  let held = 0;
  for (const secret of secrets) for (let length = Math.min(secret.length - 1, safe.length); length > held; length--) {
    if (safe.endsWith(secret.slice(0, length))) { held = length; break; }
  }
  if (held) safe = safe.slice(0, -held);
  return safe;
}
