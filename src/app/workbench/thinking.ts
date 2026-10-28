/** Project only provider-returned display text, never opaque or redacted blocks. */
export function thinkingText(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content;
  return Array.isArray(content) ? content.filter(part => part?.type === "thinking" && typeof part.thinking === "string"
    && (part.redacted === undefined || part.redacted === false)).map(part => part.thinking).join("\n\n") : "";
}

export { redactModelText } from "./redaction.ts";
