/**
 * Sensitive field redaction — recursive key-based masking.
 * Redacts: api_key, token, secret, password, cookie, authorization,
 *          access_key, private_key, session, auth, and variants.
 */
import type { TrajectoryEvent, RedactionInfo } from "./types.ts";

const SENSITIVE_KEY_PATTERNS = [
  /api[_-]?key/i, /token/i, /secret/i, /password/i, /passwd/i,
  /cookie/i, /auth(?:orization)?/i, /access[_-]?key/i,
  /private[_-]?key/i, /session/i,
];

export const REDACTED = "****";

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

/** Deep-clone and redact sensitive values recursively. */
export function redactSensitiveFields(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitiveFields);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      if (typeof value === "string" && value.length > 0) {
        result[key] = value.length <= 4 ? REDACTED : value.slice(0, 3) + REDACTED;
      } else {
        result[key] = REDACTED;
      }
    } else {
      result[key] = redactSensitiveFields(value);
    }
  }
  return result;
}

/** Apply redaction to a trajectory event's tool arguments. Returns a new event (immutable). */
export function redactEventToolArgs(event: TrajectoryEvent): TrajectoryEvent {
  if (!event.tool?.args) return event;
  const redactedArgs = redactSensitiveFields(event.tool.args);
  const hasRedaction = JSON.stringify(event.tool.args) !== JSON.stringify(redactedArgs);
  return {
    ...event,
    tool: { ...event.tool, args: redactedArgs },
    redaction: hasRedaction
      ? { hasRedaction: true, fields: findRedactedKeys(event.tool.args as Record<string, unknown>), reason: "Sensitive fields masked" }
      : undefined,
  };
}

function findRedactedKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (isSensitiveKey(key)) { keys.push(full); }
    if (!isSensitiveKey(key) && typeof value === "object" && value !== null && !Array.isArray(value)) {
      keys.push(...findRedactedKeys(value as Record<string, unknown>, full));
    }
  }
  return keys;
}
